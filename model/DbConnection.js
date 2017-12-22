/*
 * A module that is essentially a class to handle opening and closing a connection to MongoDB database.
 */

const THE_SEC_CONF = require('../config/secConf')
const THE_EMIT = require('events')
const THE_MSG_EV = 'message'

module.exports = class extends THE_EMIT {
  /**
   * Default constructor that takes the connection string URL as an argument.
   * @param {String} connURL the MongoDB connection string URL
   */
  constructor (connURL) {
    super()
    if (!connURL || typeof connURL !== 'string') throw new Error('A connection string URL for the MongoDB database must be provided.')
    this._connURL = connURL
    this._mong = require('mongoose')
    this._mong.Promise = global.Promise // Recommended: http://mongoosejs.com/docs/promises.html
    this._connDB = this._mong.connection
    this.openConnection()
  }

  /**
   * Opens a database connection.
   */
  openConnection () {
    // Only when disconnected or disconnecting
    if (this._connDB.readyState === 0) { // When disconnected
      this._connectToDB()
    } else if (this._connDB.readyState === 3) { // When disconnecting
      this._connDB.once('disconnected', this._connectToDB.bind(this)) // Wait for it
    }
  }

  /**
   * Closes the database connection.
   */
  closeConnection () {
    if (this._connDB.db) { // If there was a Db instance that can be closed
      this._connDB.db
        .close(true) // Force the close if possible
        .then(() => this._connDB.close())     // Maybe over-doing it (by disconnecting everything), but just in case
        .then(() => this._mong.disconnect())  //
        .then(() => this.emit(THE_MSG_EV, 'Connection to database is closed...'))
        .catch(err => this.emit('error', err))
    }
  }

  /**
   * Re-opens the database connection.
   */
  restartConnection () {
    if (this._connDB.db) { // If there was a Db instance that can be closed
      this._connDB.db
        .close(true) // Force the close if possible
        .then(() => this._connDB.close())
        .then(() => this._mong.disconnect())
        .then(() => {
          this.emit(THE_MSG_EV, 'Connection to database is closed...')
          this.openConnection() // Open it again
          if (THE_SEC_CONF.sessOption.store) { // If there is a connect-mongo, then update it with new connection
            if (this._mong.connection.readyState === 1) { // Same way used by connect-mongo code to reset also
              THE_SEC_CONF.sessOption.store.handleNewConnectionAsync(this._mong.connection.db)
            } else {
              this._mong.connection.once('open', () => {
                THE_SEC_CONF.sessOption.store.handleNewConnectionAsync(this._mong.connection.db)
              })
            }
          }
        })
        .catch(err => this.emit('error', err))
    } else {
      this.openConnection()
    }
  }

  /**
   * Returns the connection
   */
  getConnection () {
    return this._mong.connection
  }

  /**
   * Made just to avoid code duplication
   */
  _connectToDB () {
    this._connDB.removeAllListeners() // To avoid duplicate messages on restart
    this._connDB.once('open', something => this.emit(THE_MSG_EV, 'Connection to database is open...'))
    this._mong.connect(this._connURL, {promiseLibrary: global.Promise, useMongoClient: true})
      .then(() => this._connDB.addListener('error', err => this.emit('error', err)))
      .catch(err => this.emit('error', err))
  }
}
