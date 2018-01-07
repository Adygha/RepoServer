/*
 * A module that is essentially a class for an object that handles github communications and API.
 */

const THE_API = {
  APP_SCOPE: 'admin:repo_hook', // The permission scope requested from the user (only organization hooks; others are public read)
  OAUTH_URL: 'https://github.com/login/oauth/authorize', // The API URL to initiate create/login an access-token
  ACC_TOK_URL: 'https://github.com/login/oauth/access_token', // The API URL to validate create/login an access-token
  ACC_TOK_CHK_REVOKE_URL: 'https://api.github.com/applications/', // The API URL to check/revoke an access-token
  USER_URL: 'https://api.github.com/user' // The API URL to get user info (we get other URLs using the API responds)
}
const THE_HTTPS_PROM = require('../libs/httpsProm')
const THE_QUERY_STR = require('querystring')
const THE_WEBSK = require('websocket-driver')
// const THE_CRYPT = require('crypto')

class GithubCommunicator {
  /**
   * Default constructor.
   * @param {String} githubAppClientID the client-id for the application at github
   * @param {String} githubAppClientSecret the client-secret for the application at github
   * @param {String} appName the github's app name to pass as a user-agent (or any other name)
   * @param {String} websockPath the relative path that the websockets connect to
   */
  constructor (githubAppClientID, githubAppClientSecret, appName, websockPath) {
    this._appID = githubAppClientID
    this._appSecret = githubAppClientSecret
    this._appName = appName
    this._websockPath = websockPath
    this._webSucks = {} // Will contain the still-connected client websockets (websocket record)
    this._nextWebSuckID = -1 // To ID the next client websockets if the user is not logged in (minus for not logged-in -anonymous id-)
    this._appAuthHeader = { // The headers used for some API that needs app's authentication
      'User-Agent': this._appName,
      Authorization: 'Basic ' + Buffer.from(githubAppClientID + ':' + githubAppClientSecret).toString('base64')
    }
  }

  /**
   * Checks if the incoming request is upgrading to a websocket protocol, and handles it accordingly.
   * @param {Request} req the incoming request
   * @param {Socket} socket the communicating socket
   * @param {Buffer} body initial websocket body (couldn't find a good documentation about it; it's always initially empty in my case)
   */
  handleProbableWebsocket (req, socket, body) {
    if (req.url === this._websockPath && THE_WEBSK.isWebSocket(req)) {
      let tmpID = req.session.theUser ? (req.session.theUser.id).toString() : (this._nextWebSuckID--).toString() // Depends if logged-in
      if (this._webSucks[tmpID]) this._webSucks[tmpID].close() // Just in case it was still open from before (no doubles)
      this._webSucks[tmpID] = THE_WEBSK.http(req) // keep it in the record
      this._webSucks[tmpID].io.write(body) // Supposed to put the first data to the communication stream
      socket.pipe(this._webSucks[tmpID].io).pipe(socket) // Supposed to prepare the back and forth communications
      // this._webSucks[tmpID].messages.addListener('data', inData => this.emit('data', tmpID, inData)) // Just re-emit for now if needed (may delete)
      this._webSucks[tmpID].once('close', () => { // Delete on close
        // this._webSucks[tmpID].messages.removeAllListeners('data')
        delete this._webSucks[tmpID]
      })
      this._webSucks[tmpID].start() // Start websocket communication
    }
  }

  /**
   * Broadcast data to all listening websockets, while exempting an ID if needed
   * @param {any} theData the data to be broadcasted
   * @param {String} idToExempt an optional integer ID (as a string; it will be converted to
   *                            string anyway) to be exempt from the broadcast
   */
  websocketBroadcast (theData, idToExempt) {
    let tmpAll
    if (idToExempt) { // When exempting an ID
      let tmpExID = typeof idToExempt === 'string' ? idToExempt : idToExempt.toString()
      tmpAll = Object.assign({}, this._webSucks)
      delete tmpAll[tmpExID]
    } else {
      tmpAll = this._webSucks
    }
    for (let id in tmpAll) tmpAll[id].messages.write(theData)
  }

  /**
   * Send data to specific websocket ID (can be github's user id or the anonymous id)
   * @param {any} theData the data to be send
   * @param {String} theID the ID of the websocket
   */
  websocketSend (theData, theID) {
    let tmpID = typeof theID === 'string' ? theID : theID.toString()
    this._webSucks[tmpID].messages.write(theData)
  }

  /**
   * Closes all connected websockets
   */
  websocketCloseAll () {
    for (let id in this._webSucks) this._webSucks[id].close() // Deleting will happen at the event listener
  }

  /**
   * Checks if the access-token is still valid.
   * @param {String} theAccToken the access-token to be checked
   * @returns {Promise<Boolean>} true if the access-token is still valid
   */
  checkAccessToken (theAccToken) {
    return THE_HTTPS_PROM.promGET(THE_API.ACC_TOK_CHK_REVOKE_URL + this._appID + '/tokens/' + theAccToken, this._appAuthHeader)
      .then(() => true)
      .catch(() => false)
  }

  /**
   * Revokes the access-token (just the access-token and not the user) from further
   * use (for logging-out; and does not remove the user from our github-app).
   * @param {String} theAccToken the access-token to be revoked
   * @returns {Promise<Boolean>} true if the access-token is successfully revoked
   */
  revokeAccessToken (theAccToken) {
    return THE_HTTPS_PROM.promPOST(THE_API.ACC_TOK_CHK_REVOKE_URL + this._appID + '/tokens/' + theAccToken, '', this._appAuthHeader)
      .then(() => true)
      .catch(() => false) // This will happen when the response is an error page and it's safe to just return a false promise
  }

  /**
   * Initiate github login by creating the full github URL to redirect to, that initiates the login.
   * @param {Request} theReq the request that holds the session that holds the user data
   * @returns {Promise<String>} the URL to redirect to
   */
  initiateLogin (theReq) {
    return new Promise((resolve, reject) => {
      delete theReq.session.theGithubAccessToken  // Get rid of old data if any
      delete theReq.session.theUser               //
      require('crypto').randomBytes(16, (err, tokenBuf) => { // This will generate a new 32 hex 'state' token to prevent cross-site request forgery
        if (err) return reject(err)
        theReq.session.theLastGithubStateToken = tokenBuf.toString('hex') // Add it to session to use it a bit later
        resolve(THE_HTTPS_PROM.urlFormat({ // Build the query in the URL to redirect to
          pathname: THE_API.OAUTH_URL,
          query: {
            client_id: this._appID,
            scope: THE_API.APP_SCOPE,
            state: theReq.session.theLastGithubStateToken
          }
        }))
      })
    })
  }

  /**
   * Continue github login and put the needed user data in the session.
   * @param {Request} theReq the request that holds the session that holds the user data
   * @param {String} githubCodeToExchange the received github-code to exchange with access-token
   * @returns {Promise} will hold no data on success but an error on failure
   */
  continueLogin (theReq, githubCodeToExchange) {
    return new Promise((resolve, reject) => {
      let tmpToken // To save token between 'then' calls
      THE_HTTPS_PROM.promPOST(THE_API.ACC_TOK_URL, THE_QUERY_STR.stringify({
        // client_id: this._appID,         //
        // client_secret: this._appSecret, // The app's credentials (will be sent in the headers)
        code: theReq.query.code, // the received code
        state: theReq.session.theLastGithubStateToken // The state-token (will be deleted just soon)
      }), this._appAuthHeader)
      .then(respDataBuf => { // Here we got the data resulted from POST request (contains the access-token)
        delete theReq.session.theLastGithubStateToken // Better delete this one since succeeded and no need for it
        tmpToken = THE_QUERY_STR.parse(respDataBuf.toString()).access_token // The actual access-token
        return this.getUserData(tmpToken)
      })
      .then(userDataBuf => {
        theReq.session.regenerate(err => {
          if (err) return reject(err)
          let tmpUser = JSON.parse(userDataBuf.toString())
          theReq.session.theGithubAccessToken = tmpToken // Keep it in session (but away from user object just in case)
          theReq.session.theUser = tmpUser // We'll need the URLs in the object but will extract only needed data to the view later
          resolve()
        })
      })
      .catch(reject) // Pass the error
    })
  }

  /**
   * Log-out the user using session data.
   * @param {Request} theReq the request that holds the session that holds the user data
   * @returns {Promise<Boolean>} true if logout is successful
   */
  logoutUser (theReq) {
    return new Promise((resolve, reject) => {
      this.revokeAccessToken(theReq.session.theGithubAccessToken)
        .then(() => { // In any case it is revoked
          delete theReq.session.theUser
          delete theReq.session.theGithubAccessToken
          theReq.session.regenerate(err => { // Used regenerate and not destroy so that we can pass the flash message later
            if (err) reject(err) // This is an error that should be rejected (not just resolve it to false)
            resolve(true)
          })
        })
        .catch(() => resolve(false)) // This will happen when the response is an error page and it's safe to just return a false promise
    })
  }

  /**
   * Gets the guthub's user data object
   * @param {String} theUserAccToken the user's access-token
   * @returns {Promise<Object>} the guthub's user data object
   */
  getUserData (theUserAccToken) {
    return THE_HTTPS_PROM.promGET(THE_API.USER_URL, this._userAuthHeaderFactory(theUserAccToken))
  }

  /**
   * Generates headers to pass with HTTP methods
   * @param {String} theUserAccToken the user's access-token
   * @returns {Object} the generated headers
   */
  _userAuthHeaderFactory (theUserAccToken) {
    return {'User-Agent': this._appName, Authorization: 'token ' + theUserAccToken}
  }
}

let githubComm

/**
 * To get a singleton object to communicate with github.
 * @param {String} githubAppClientID the app's github client-ID
 * @param {String} githubAppClientSecret the app's github client-secret
 * @param {String} appName the github's app name to pass as a user-agent (or any other name)
 * @returns {GithubCommunicator} the singleton communicator object
 */
module.exports = function (githubAppClientID, githubAppClientSecret, appName) {
  return githubComm || (githubComm = new GithubCommunicator(githubAppClientID, githubAppClientSecret, appName)) // To return a singleton (just in case we use it in different modules)
}
