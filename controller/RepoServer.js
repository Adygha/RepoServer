/*
 * A module that is essentially a class that represents a repo-server. (Seemed more
 * appropriate to make it a controller because it handles controlling the routes)
 */

const THE_SEC_CONF = require('../config/secConf')
const THE_CONF = require('../conf/conf')
const THE_PATH = require('path')
const THE_EXP = require('express')
const THE_SESS = require('express-session')
const THE_ENGN = require('express-handlebars')
const THE_PARSE = require('body-parser')
const THE_CUST_ERRS = require('../libs/CustomErrors')
const ConsoleView = require('../view/ConsoleView')
const DbConn = require('../model/DbConnection')
const MongoStore = require('connect-mongo')(THE_SESS)

const THE_WEBSOCK_PATH = '/websock' // What path that handles websocket communications
const THE_GIHUB_COMM = require('../view/githubComm')(THE_SEC_CONF.githubAppClientID, THE_SEC_CONF.githubAppClientSecret, THE_SEC_CONF.appName, THE_WEBSOCK_PATH)

module.exports = class {
  constructor () {
    this._isMaintenance = false
    this._consView = new ConsoleView()                                                  //
    this._consView.addListener('quit', () => this.stopServer(true))                     //
    this._consView.addListener('restart', () => this.restartServer())                   // Hookup with server's console
    this._consView.addListener('tog-maintenance', this.toggleMaintenaceMode.bind(this)) //
    this._consView.beginWatch()                                                         //

    this._dbModel = new DbConn(THE_SEC_CONF.dbURL)
    this._dbModel.addListener('error', err => this._consView.displayMessage('A database error occurred with message: [%s].', err.message))
    this._dbModel.addListener('message', this._consView.displayMessage)

    this._svrApp = THE_EXP()
    this._svrApp.use(THE_EXP.static(THE_PATH.join(process.cwd(), 'www'))) // I put this here so that static requests don't do extra load
    this._svrApp.engine('.hbs', THE_ENGN({
      layoutsDir: THE_PATH.join(process.cwd(), 'view/layouts'),   //
      partialsDir: THE_PATH.join(process.cwd(), 'view/partials'), // Needed for changing the 'views' name (or else errors happen).
      defaultLayout: 'main',
      extname: '.hbs',
      helpers: {toJSON: data => {
        return encodeURIComponent(JSON.stringify(data))
      }} // To pass data to javascript files at the client side
    }))
    this._svrApp.set('view engine', '.hbs')
    this._svrApp.set('views', THE_PATH.join(process.cwd(), 'view')) // Just changing the 'views' name
    this._svrApp.use(THE_PARSE.json()) // If needed later
    this._svrApp.use(THE_PARSE.urlencoded({extended: true}))
    THE_SEC_CONF.sessOption.store = new MongoStore({mongooseConnection: this._dbModel.getConnection(), collection: 'assign3sess'}) // Add connect-mongo to options
    this._svrApp.use(THE_SESS(THE_SEC_CONF.sessOption))
    this._svrApp.use(this._flashMid) // We will need the flash messages
    this._svrApp.use(this._mixedMid.bind(this))

    // Next, the routes:
    this._svrApp.use('/', require('./index'))
    this._svrApp.use('/', require('./login'))
    this._svrApp.use('/', require('./user'))
    this._svrApp.use('/', require('./webhook'))

    this._svrApp.use((req, resp, next) => resp.status(404).render('error/404'))
    this._svrApp.use(this._errorHandler.bind(this)) // To maybe filter the errors later

    this._consView.displayWelcomeMessage()
  }

  /**
   * Starts the listening server.
   */
  startServer () {
    if (this._svr && !this._svr.listening) { // If there is already a listening server that has stopped listening then just re-listen
      this._svr.listen(THE_CONF.port, () => this._consView.displayMessage('Server re-started...'))
    } else if (!this._svr) { // If no listening server yet
      this._svr = this._svrApp.listen(THE_CONF.port, () => this._consView.displayMessage('Server started...'))
      this._svr.addListener('upgrade', THE_GIHUB_COMM.handleProbableWebsocket.bind(THE_GIHUB_COMM))
    }
    if (this._isMaintenance) this.toggleMaintenaceMode()
  }

  /**
   * Stops the listening server temporarily or permanently.
   * @param {Boolean} isFinalStop true if we need to finalize and cleanup preparing to close server, or false to
   *                              just temporariy stop the listening server.
   */
  stopServer (isFinalStop) {
    if (this._svr.listening) this._svr.close(() => this._consView.displayMessage('Stopping server...')) // Only stop if it's listening
    if (isFinalStop) { // If preparing to close (doen't matter if this one raced)
      this._consView.removeAllListeners()   // Detach the console
      this._consView.endWatch()             //
      THE_GIHUB_COMM.websocketCloseAll() // Close websockets
      this._svr.removeAllListeners() // Cleanup listeners
      this._dbModel.closeConnection() // Close DB
    }
  }

  /**
   * Re-starts the listening server (do not use it to start the server from scrach).
   */
  restartServer () {
    if (this._svr.listening) { // Only stop server if it's listening
      this._svr.close(() => {
        this._consView.displayMessage('Re-starting server...')
        this.startServer() // Only start server after done closing
      })
    } else {
      this.startServer() // Supposed to be safe to start it now
    }
    this._dbModel.restartConnection() // Restart the database instance
    this._consView.displayWelcomeMessage() // Display the welcome message again and restart the console page
  }

  /**
   * Toggles the server's maintenance mode.
   */
  toggleMaintenaceMode () {
    this._isMaintenance = !this._isMaintenance
    this._consView.displayMessage(this._isMaintenance
      ? 'The server is under maintenance mode.'
      : 'The server resumed from maintenance mode.')
  }

  // After here are the helper methods (considered like private)

  /**
   * A middleware to handle mixed small stuff (that are not worth making as separate).
   * @param {Request} req the incoming request
   * @param {Response} resp the outgoing response
   * @param {Function} next the function to continue the chain
   */
  _mixedMid (req, resp, next) {
    if (req.session.theGithubAccessToken && req.session.theUser) {
      resp.locals.theUser = { // Pass the user to the view (only the needed data)
        displayName: req.session.theUser.name,
        userName: req.session.theUser.login,
        avatarURL: req.session.theUser.avatar_url
      }
    }
    resp.locals.websockPath = THE_WEBSOCK_PATH
    resp.locals.theNavAnchs = THE_CONF.theNavAnchs // Pass the header links/anchors to the view
    // resp.set('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0') // Recommended (not tested)
    this._isMaintenance // Checks if under maintenance
    ? next(new THE_CUST_ERRS.UnderMaintenanceError('Site is under maintenance. Please visite later.'))
    : next()
  }

  /**
   * A middleware to handle the flash messages.
   * @param {Request} req the incoming request
   * @param {Response} resp the outgoing response
   * @param {Function} next the function to continue the chain
   */
  _flashMid (req, resp, next) {
    if (req.session.theFlash) {
      resp.locals.theFlash = req.session.theFlash
      delete req.session.theFlash
    }
    next()
  }

  /**
   * A general error handler (to maybe filter the errors later).
   * @param {Error} err the passes error
   * @param {Request} req the incoming request
   * @param {Response} resp the outgoing response
   * @param {Function} next the function to continue the chain
   */
  _errorHandler (err, req, resp, next) {
    // This next delegation (in the conditon) is recommended by: http://expressjs.com/en/guide/error-handling.html to
    // suppress any still going requests/responses (this will not happen here, but just in case. Should I remove it?).
    if (resp.headersSent) return next(err)
    switch (err.constructor) { // If the error is one of our custom errors, then handle it differently
      case THE_CUST_ERRS.InvalidHttpParamError: // When the HTTP request has an invalid parameter
        resp.status(400).render('error/400', {theErrMsg: err.message}) // Thought it's better than 422 after reading: https://www.bennadel.com/blog/2434-http-status-codes-for-invalid-data-400-vs-422.htm
        break
      case THE_CUST_ERRS.DatabaseNotAvailableError: // When there is no available database connection
      case THE_CUST_ERRS.UnderMaintenanceError: // When under maintenance
        resp.status(503).render('error/503', {theErrMsg: err.message})
        break
      default: // Handle it as a general error
        this._consView.displayMessage('An error occurred with message: [%s].', err.message)
        resp.status(500).render('error/500')
    }
  }
}
