const THE_HTTPS_PROM = require('../libs/httpsProm')
const THE_SEC_CONF = require('../config/secConf')
const THE_QUERY_S = require('querystring')
let outRouter = require('express').Router()

outRouter.route('/login')
  .get((req, resp, next) => {
    if (req.query.logout) { // If it's a logout request, then delete the user data fom session and redirect
      delete req.session.theUser
      delete req.session.theGithubAccessToken
      req.session.regenerate(err => { // Used regenerate and not destroy so that we can pass the flash message
        if (err) return next(err) // Will continue after this safely
        resp.clearCookie(THE_SEC_CONF.sessOption.name) // It helps too
        req.session.theFlash = {type: 'msg-info', msg: 'Logged-out succefully.'}
        resp.redirect('/')
      })
    } else if (req.session.theGithubAccessToken && req.session.theUser) { // If already logged-in, then redirect to site root with flash message
      req.session.theFlash = {type: 'msg-info', msg: 'You are already logged-in.'}
      resp.redirect('/')
    } else { // Else, need github login
      require('crypto').randomBytes(16, (err, tokenBuf) => { // This will generate a 32 hex string
        if (err) return next(err)
        req.session.theLastGithubStateToken = tokenBuf.toString('hex') // Add it to session to use it later
        let tmpRedirect = THE_HTTPS_PROM.urlFormat({ // Build the query in the URL to redirect to
          pathname: THE_SEC_CONF.githubAppAuthURL, // The github's authentication URL
          query: {
            client_id: THE_SEC_CONF.githubAppClientID, // The app's client-id at githup
            scope: THE_SEC_CONF.githubAppScope, // The permission scope for the app
            state: req.session.theLastGithubStateToken // The 'state' token to prevent cross-site request forgery
          }
        })
        // resp.setHeader('X-OAuth-Scopes', 'admin:repo_hook repo') // I was trying to put all query as headers instead but there seems to be no way
        resp.redirect(tmpRedirect)
      })
    }
  })

outRouter.route('/login/back')
  .get((req, resp, next) => {
    if (req.session.theLastGithubStateToken && req.session.theLastGithubStateToken === req.query.state) { // If there was a previous state-token and it is equal to the one redirected to us
      let tmpAccToken // To pass the token between 'then' calls
      THE_HTTPS_PROM.promPOST(THE_SEC_CONF.githubAppAccessTokenURL, THE_QUERY_S.stringify({
        client_id: THE_SEC_CONF.githubAppClientID, // The app's client-id at githup
        client_secret: THE_SEC_CONF.githubAppClientSecret,
        code: req.query.code,
        state: req.session.theLastGithubStateToken
      }), THE_SEC_CONF.appName)
      .then(respData => { // After getting the data resulted from POST request (contains the access-token)
        let tmpTokenData = THE_QUERY_S.parse(respData.toString())
        delete req.session.theLastGithubStateToken // Better delete this one
        tmpAccToken = tmpTokenData.access_token
        return THE_HTTPS_PROM.promGET(THE_SEC_CONF.githubUserURL, THE_SEC_CONF.appName, 'token ' + tmpAccToken) // Get the user data to display when logged in (passing the access-token in the header is recommended)
      })
      .then(userData => { // After getting the user data resulted from GET request
        req.session.regenerate(err => { // Better to regenerate after login
          if (err) return next(err)
          let tmpUser = JSON.parse(userData.toString())
          req.session.theGithubAccessToken = tmpAccToken // Might need to keep the access-token with session
          req.session.theUser = {displayName: tmpUser.name, userName: tmpUser.login} // Extract only needed data and keep it with session
          req.session.theFlash = {type: 'msg-info', msg: 'Login successful...'}
          resp.redirect('/')
        })
      })
      .catch(next) // Pass if error
    } else { // Else, there is state-token mismatch (most likely cross-site request forgery)
      resp.status(400) // Bad request seems better here
    }
  })

module.exports = outRouter
