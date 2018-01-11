/*
 * A module that is essentially a class for an object that handles github communications and API.
 */

const THE_API = {
  APP_SCOPE: 'repo write:repo_hook', // The permission scope requested from the user (only organization hooks; others are public read)
  APP_REPO_WEBHOOK_EVENTS: ['issues', 'issue_comment'], // The required webhook events for the app's repo
  USER_REPO_WEBHOOK_EVENTS: ['*'], // The required webhook events fro the user's repo
  APP_WEBHOOK_DELIVERY_URL: 'https://azmat.se/webhook', // The URL where this app will recieve rebhook deliveries from github
  MAIN_APP_ISSUES_URL: 'https://api.github.com/repos/1dv523/ja223gs-examination-3/issues?state=all', // The app's issues (for main page)
  MAIN_APP_HOOKS_URL: 'https://api.github.com/repos/1dv523/ja223gs-examination-3/hooks', // The app's hooks (for main page)
  OAUTH_URL: 'https://github.com/login/oauth/authorize', // The API URL to initiate create/login an access-token
  ACC_TOK_URL: 'https://github.com/login/oauth/access_token', // The API URL to validate create/login an access-token
  ACC_TOK_CHK_REVOKE_URL: 'https://api.github.com/applications/', // The API URL to check/revoke an access-token
  USER_URL: 'https://api.github.com/user', // The API URL to get user info (we get other URLs using the API responds)
  USER_REPOS_URL: 'https://api.github.com/user/repos' // The API URL to get user repos (this one will get the private also)
}
const THE_HTTPS_PROM = require('../libs/httpsProm')
const THE_QUERY_STR = require('querystring')
const THE_WEBSK = require('websocket-driver')
const THE_COOKIE = require('cookie')
const THE_COOKIE_SIG = require('cookie-signature')
const THE_SEC_CONF = require('../config/secConf')

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
    this._webSucks = new Map() // Will contain the still-connected client websockets (websocket record)
    this._nextWebSuckID = -1 // To ID the next client websockets if the user is not logged in (minus for not logged-in -anonymous id-)
    this._appAuthHeader = { // The headers used for some API that needs app's authentication
      'User-Agent': this._appName,
      Authorization: 'Basic ' + Buffer.from(githubAppClientID + ':' + githubAppClientSecret).toString('base64')
    }
    this.manageRepoWebhook(THE_API.MAIN_APP_HOOKS_URL, THE_SEC_CONF.githubAppExamRepoToken, false, true)
      .then(webhookBuf => (this._appWebHook = JSON.parse(webhookBuf.toString())))
      .catch(() => (this._canUseMainWebHook = false))
  }

  /**
   * Checks if the incoming request is upgrading to a websocket protocol, and handles it accordingly.
   * @param {Request} websockReq the incoming websocket connection request
   * @param {Socket} commSocket the communicating socket
   * @param {Buffer} initBody initial websocket body (couldn't find a good documentation about it; it's always initially empty in my case)
   */
  handleProbableWebsocket (websockReq, commSocket, initBody) {
    if (websockReq.url === this._websockPath && THE_WEBSK.isWebSocket(websockReq)) {
      this._extractSession(websockReq)
        .then(theSession => {
          let tmpID = theSession && theSession.theUser ? theSession.theUser.id : this._nextWebSuckID-- // Depends on if there is session and if logged-in
          if (this._webSucks.has(tmpID)) { // If there is a previous websocket with same ID then close it (just in case it was still open from before -no doubles-)
            this._webSucks.get(tmpID).messages.removeAllListeners('data')
            this._webSucks.get(tmpID).close()
            this._webSucks.delete(tmpID)
          }
          this._webSucks.set(tmpID, THE_WEBSK.http(websockReq)) // keep it in the record (or replace the old closed one)
          if (tmpID > -1) this._webSucks.get(tmpID).theGithubAccessToken = theSession.theGithubAccessToken // Attach the token to websocket
          this._webSucks.get(tmpID).io.write(initBody) // Supposed to put the first data to the communication stream
          commSocket.pipe(this._webSucks.get(tmpID).io).pipe(commSocket) // Supposed to prepare the back and forth communications
          this._webSucks.get(tmpID).messages.addListener('data', inData => this._websockDataHandler(inData, tmpID)) // When data comes
          // this._webSucks.get(tmpID).once('close', () => { // Delete webhooks on close
          //   this._webSucks.get(tmpID).messages.removeAllListeners('data')
          //   this._webSucks.delete(tmpID)
          // })
          this._webSucks.get(tmpID).start() // Start websocket communication
        })
    }
  }

  /**
   * Broadcast data to all listening websockets, while exempting an ID if needed
   * @param {String} theData the data to be broadcasted
   * @param {Number} idToExempt an optional integer ID to be exempt from the broadcast
   */
  websocketBroadcast (theData, idToExempt) {
    let tmpAll
    if (idToExempt && this._webSucks.has(idToExempt)) { // When exempting an existing ID
      tmpAll = new Map(this._webSucks) // Create a shallow copy
      tmpAll.delete(idToExempt)
    } else { // When send to all
      tmpAll = this._webSucks
    }
    tmpAll.forEach(sock => sock.messages.write(theData)) // Send to all left
  }

  /**
   * Send data to specific websocket ID (can be github's user id or the anonymous id)
   * @param {String} theData the data to be send
   * @param {Number} theID the ID of the websocket
   */
  websocketSend (theData, theID) {
    this._webSucks.get(theID).messages.write(theData)
  }

  /**
   * Closes all connected websockets
   */
  websocketCloseAll () {
    if (this._appWebHook) this.manageRepoWebhook(this._appWebHook.url, THE_SEC_CONF.githubAppExamRepoToken, false, false) // delete the app's webhook
    this._webSucks.forEach((sock, sockID) => {
      sock.messages.removeAllListeners('data')
      sock.close()
      this._webSucks.delete(sockID)
    })
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
   * @returns {Promise<Buffer>} the guthub's user data buffer
   */
  getUserData (theUserAccToken) {
    return THE_HTTPS_PROM.promGET(THE_API.USER_URL, this._userAuthHeaderFactory(theUserAccToken))
  }

  /**
   * Gets the the main app's repo issues (to display on main page)
   */
  getMainAppRepoIssues () { // This method maybe redundant
    return THE_HTTPS_PROM.promGET(THE_API.MAIN_APP_ISSUES_URL, this._userAuthHeaderFactory(THE_SEC_CONF.githubAppExamRepoToken))
  }

  /**
   * Gets the guthub's user repos
   * @param {String} theUserAccToken the user's access-token
   * @returns {Promise<Buffer>} the guthub's repos' data buffer
   */
  getUserRepos (theUserAccToken) {
    return THE_HTTPS_PROM.promGET(THE_API.USER_REPOS_URL, this._userAuthHeaderFactory(theUserAccToken))
  }

  /**
   * Gets the guthub's user repo issues
   * @param {String} issuesURL the URL for the issues (got from the repo object)
   * @param {String} theUserAccToken the user's access-token
   * @returns {Promise<Buffer>} the guthub's issues' data buffer
   */
  getUserRepoIssues (issuesURL, theUserAccToken) {
    return THE_HTTPS_PROM.promGET(issuesURL, this._userAuthHeaderFactory(theUserAccToken))
  }

  /**
   * Gets the guthub's issues comment
   * @param {String} commentsURL the URL for the comment (got from the issue object)
   * @param {String} theUserAccToken the user's access-token
   * @returns {Promise<Buffer>} the guthub's comments' data buffer
   */
  getUserRepoIssueComments (commentsURL, theUserAccToken) {
    return THE_HTTPS_PROM.promGET(commentsURL, this._userAuthHeaderFactory(theUserAccToken))
  }

  /**
   * Creates or deletes a webkook to/from a github repo.
   * @param {String} webhooksURL the URL for the repo webhooks
   * @param {String} theRepoOwnerAccToken the access-token for the repo owner (the user's or this app's)
   * @param {Boolean} isUserWebhook true if the repo is a user repo
   * @param {Boolean} isCreate true to create, or false to delete
   * @returns {Promise<Buffer>} github's reponses payload buffer
   */
  manageRepoWebhook (webhooksURL, theRepoOwnerAccToken, isUserWebhook, isCreate) {
    if (isCreate) { // When creating a webhook
      let tmpPayload = { // Prepare the wehook creation request payload
        name: 'web', // A must
        active: true, // The webhook is active from start
        events: isUserWebhook ? THE_API.USER_REPO_WEBHOOK_EVENTS : THE_API.APP_REPO_WEBHOOK_EVENTS, // the requested events
        config: { // Our app's configurations
          url: THE_API.APP_WEBHOOK_DELIVERY_URL, // Where to deliver
          secret: isUserWebhook ? THE_SEC_CONF.githubUserWebHookSecret : THE_SEC_CONF.githubAppWebHookSecret,
          content_type: 'json' // Deliver as JSON
        }
      }
      return THE_HTTPS_PROM.promPOST(webhooksURL, JSON.stringify(tmpPayload), this._userAuthHeaderFactory(theRepoOwnerAccToken))
    } else { // When deleting a webhook
      return THE_HTTPS_PROM.promDELETE(webhooksURL, this._userAuthHeaderFactory(theRepoOwnerAccToken))
    }
  }

  /**
   * Extracts the session from the request if any.
   * @param {Request} websockReq
   * @returns {Promise<Session>} a promise containing the session or null (will never reject with error).
   */
  _extractSession (websockReq) {
    return new Promise((resolve, reject) => {
      let tmpCookie = websockReq.headers.cookie ? THE_COOKIE.parse(websockReq.headers.cookie)[THE_SEC_CONF.sessOption.name] : null // Get cookie
      if (tmpCookie) {
        tmpCookie = THE_COOKIE_SIG.unsign(tmpCookie.slice(2), THE_SEC_CONF.sessOption.secret) // Unsign the cookie
        THE_SEC_CONF.sessOption.store.get(tmpCookie, (err, userSession) => {
          if (err) resolve(null) // No need to reject, only resolve null
          resolve(userSession)
        })
      } else {
        resolve(null)
      }
    })
  }

  /**
   * Generates headers to pass with HTTP methods
   * @param {String} theUserAccToken the user's access-token
   * @returns {Object} the generated headers
   */
  _userAuthHeaderFactory (theUserAccToken) {
    return {'User-Agent': this._appName, Authorization: 'token ' + theUserAccToken}
  }

  /**
   * Handles the 'data' event (dot directly) for the websocket
   * @param {Object} theData the data to be handled
   * @param {Number} sockID the ID of the websocket (the ID of the user or the negative key ID)
   */
  _websockDataHandler (theData, sockID) {
    let tmpData = JSON.parse(theData)
    switch (tmpData.type) {
      case 'all-user-repos': // When, initially, all user's repos' data is requested
        if (sockID < 0) { // Can't get repo data without having a logged-in user
          this.websocketSend(JSON.stringify({type: 'error', message: 'Not logged-in'}), sockID)
        } else {
          let tmpRepos
          this.getUserRepos(this._webSucks.get(sockID).theGithubAccessToken)
            // .then(reposBuf => this.websocketSend(JSON.stringify({type: 'all-user-repos', content: JSON.parse(reposBuf.toString())}), sockID)) // Send repos
            .then(reposBuf => { // Now the repos are fetched
              tmpRepos = JSON.parse(reposBuf.toString())
              let tmpPromises = [] // An array of promises to resolve all
              tmpRepos.forEach(repo => { // Get the repo issues for every repo
                if (repo.has_issues) {
                  let tmpIndx = repo.issues_url.indexOf('{')
                  if (tmpIndx < 0) tmpIndx = repo.issues_url.length // Just in case there is no '{' in the URL
                  let tmpIssues = this.getUserRepoIssues(repo.issues_url.substring(0, tmpIndx), this._webSucks.get(sockID).theGithubAccessToken)
                    .then(issuesBuf => (repo.theIssues = JSON.parse(issuesBuf.toString()))) // Assign the issues to their repo
                    .catch(() => this.websocketSend(JSON.stringify({ // only send for this issue (and dont fail the whole process)
                      type: 'error',
                      message: 'Cannot retrieve repo ' + repo.name + ' issue. Re-login if error persists.'
                    }), sockID))
                  tmpPromises.push(tmpIssues)
                }
              })
              return Promise.all(tmpPromises)
            })
            .then(() => { // Now the issues are fetched (no need to specify them, they are alredy assigned to repos)
              let tmpPromises = [] // An array of promises to resolve all
              tmpRepos.forEach(repo => { // Here we fetch all comments
                if (repo.has_issues) {
                  repo.theIssues.forEach(issue => {
                    if (issue.comments > 0) {
                      let tmpComms = this.getUserRepoIssueComments(issue.comments_url, this._webSucks.get(sockID).theGithubAccessToken)
                        .then(commsBuf => (issue.theComments = JSON.parse(commsBuf.toString()))) // Assign the comments to their issue
                        .catch(() => this.websocketSend(JSON.stringify({ // only send for this comment (and dont fail the whole process)
                          type: 'error',
                          message: 'Cannot retrieve issue ' + issue.title + ' comment. Re-login if error persists.'
                        }), sockID))
                      tmpPromises.push(tmpComms)
                    }
                  })
                }
              })
              return Promise.all(tmpPromises)
            })
            .then(() => { // Now the comments are fetched (no need to specify them, they are alredy assigned to issues)
              let tmpPromises = [] // An array of promises to resolve all
              tmpRepos.forEach(repo => { // Here we create webhooks for every repo
                let tmpHook = this.manageRepoWebhook(repo.hooks_url, this._webSucks.get(sockID).theGithubAccessToken, true, true)
                  .then(webhookBuf => (repo.theWebHook = JSON.parse(webhookBuf.toString()))) // Add the wehook to repo
                  .catch(() => { // This happenes when the repo is already created
                    this.websocketSend(JSON.stringify({ // only send for this webhook error (and dont fail the whole process)
                      type: 'error',
                      message: 'A webhook for repo ' + repo.name + ' already created. Re-login or delete repo\'s webhooks if it is not.'
                    }), sockID)
                  })
                tmpPromises.push(tmpHook)
              })
              return Promise.all(tmpPromises)
            })
            .then(() => this.websocketSend(JSON.stringify({type: 'all-user-repos', content: tmpRepos}), sockID)) // Now the webhooks are created and we send repos
            .catch(() => { // Send an error message
              this.websocketSend(JSON.stringify({
                type: 'error',
                message: 'Cannot retrieve repos. Re-login if error persists.'
              }), sockID)
            })
        }
        break
      case 'main-app-issues': // When visiting the main page and requesting this application's issue data
        let tmpIssues
        this.getMainAppRepoIssues()
          .then(issuesBuf => {
            let tmpPromises = [] // An array of promises to resolve all
            tmpIssues = JSON.parse(issuesBuf.toString())
            tmpIssues.forEach(issue => {
              if (issue.comments > 0) {
                let tmpComms = this.getUserRepoIssueComments(issue.comments_url, THE_SEC_CONF.githubAppExamRepoToken)
                  .then(commsBuf => (issue.theComments = JSON.parse(commsBuf.toString()))) // Assign the comments to their issue
                  .catch(() => this.websocketSend(JSON.stringify({ // only send for this comment (and dont fail the whole process)
                    type: 'error',
                    message: 'Cannot retrieve an issue from app\'s repo. Please try again later.'
                  }), sockID))
                tmpPromises.push(tmpComms)
              }
            })
            return Promise.all(tmpPromises)
          })
          .then(() => { // Comment retrieved for now (inside the issues), just send the issues
            this.websocketSend(JSON.stringify({type: 'main-app-issues', content: tmpIssues}), sockID)
          })
          .catch(() => { // Send an error message
            this.websocketSend(JSON.stringify({type: 'error', message: 'Cannot retrieve issues. Please try again later.'}), sockID)
          })
        break
      case 'repo-webhook-enable': // Webhook enable requested
        this.manageRepoWebhook(tmpData.content.hooksURL, this._webSucks.get(sockID).theGithubAccessToken, true, true)
          .then(webhookBuf => { // When successfully created webhook
            if (tmpData.content.needResponse) { // If response is requested, response with enabled and the webhook
              this.websocketSend(JSON.stringify({
                type: 'repo-webhook-enabled',
                content: {id: tmpData.content.id, theWebHook: JSON.parse(webhookBuf.toString())}
              }), sockID)
            }
          })
          .catch(() => { // Here, the webhook is most likely already created
            this.websocketSend(JSON.stringify({ // only send for this webhook (and dont fail the whole process)
              type: 'error',
              message: 'The webhook requested is already created. Re-login or delete repo\'s webhooks if it is not.'
            }), sockID)
          })
        break
      case 'repo-webhook-disable': // Webhook disable requested
        this.manageRepoWebhook(tmpData.content.hooksURL, this._webSucks.get(sockID).theGithubAccessToken, true, false)
          .then(() => {
            if (tmpData.content.needResponse) { // If response is requested, response with disabled
              this.websocketSend(JSON.stringify({type: 'repo-webhook-disabled', content: {id: tmpData.content.id}}), sockID)
            }
          })
          .catch(() => { // When error
            if (tmpData.content.needResponse) { // Only response if needed
              this.websocketSend(JSON.stringify({ // only send for this webhook (and dont fail the whole process)
                type: 'error',
                message: 'Error when deleting webhook. Maybe the webhook is already deleted.'
              }), sockID)
            }
          })
        break
      case 'user-repo-update':
        let tmpRepo
        THE_HTTPS_PROM.promGET(tmpData.content.repoURL, this._userAuthHeaderFactory(this._webSucks.get(sockID).theGithubAccessToken))
          .then(repoBuf => {
            tmpRepo = JSON.parse(repoBuf.toString())
            if (tmpRepo.has_issues) {
              let tmpIndx = tmpRepo.issues_url.indexOf('{')
              if (tmpIndx < 0) tmpIndx = tmpRepo.issues_url.length // Just in case there is no '{' in the URL
              return this.getUserRepoIssues(tmpRepo.issues_url.substring(0, tmpIndx), this._webSucks.get(sockID).theGithubAccessToken)
                .then(issuesBuf => (tmpRepo.theIssues = JSON.parse(issuesBuf.toString()))) // Assign the issues to their repo
                .catch(() => this.websocketSend(JSON.stringify({ // only send for this issue (and dont fail the whole process)
                  type: 'error',
                  message: 'Cannot retrieve repo ' + tmpRepo.name + ' issue. Re-login if error persists.'
                }), sockID))
            }
          })
          .then(() => { // Now the issues are fetched (no need to specify them, they are alredy assigned to repo)
            let tmpPromises = []
            tmpRepo.theIssues.forEach(issue => {
              if (issue.comments > 0) {
                let tmpComms = this.getUserRepoIssueComments(issue.comments_url, this._webSucks.get(sockID).theGithubAccessToken)
                  .then(commsBuf => (issue.theComments = JSON.parse(commsBuf.toString()))) // Assign the comments to their issue
                  .catch(() => this.websocketSend(JSON.stringify({ // only send for this comment (and dont fail the whole process)
                    type: 'error',
                    message: 'Cannot retrieve issue ' + issue.title + ' comment. Re-login if error persists.'
                  }), sockID))
                tmpPromises.push(tmpComms)
              }
            })
            return Promise.all(tmpPromises)
          })
          .then(() => this.websocketSend(JSON.stringify({type: 'user-repo-updated', content: tmpRepo}), sockID))// Now the comments are fetched (no need to specify them, they are alredy assigned to issues)
    }
  }
}

let githubComm

/**
 * To get a singleton object to communicate with github.
 * @param {String} githubAppClientID the app's github client-ID
 * @param {String} githubAppClientSecret the app's github client-secret
 * @param {String} appName the github's app name to pass as a user-agent (or any other name)
 * @param {String} websockPath the relative path that the websocket server will listen to
 * @returns {GithubCommunicator} the singleton communicator object
 */
module.exports = function (githubAppClientID, githubAppClientSecret, appName, websockPath) {
  return githubComm || (githubComm = new GithubCommunicator(githubAppClientID, githubAppClientSecret, appName, websockPath)) // To return a singleton (just in case we use it in different modules)
}
