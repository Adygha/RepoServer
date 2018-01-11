/**
 * Handles the '/login' route.
 */

const THE_SEC_CONF = require('../config/secConf')
const THE_GIHUB_COMM = require('../view/githubComm')()  // (THE_SEC_CONF.githubAppClientID, THE_SEC_CONF.githubAppClientSecret, THE_SEC_CONF.appName)
let outRouter = require('express').Router()

outRouter.route('/login') // Github login initiation route (or just logout)
  .get((req, resp, next) => {
    if (req.query.logout) { // If it's a logout request, then delete the user data fom session and redirect
      THE_GIHUB_COMM.logoutUser(req)
        .then(() => {
          resp.clearCookie(THE_SEC_CONF.sessOption.name) // It helps too (might delete)
          req.session.theFlash = {type: 'msg-info', msg: 'Logged-out succefully.'}
          resp.redirect('/')
        })
        .catch(next)
    } else if (req.session.theGithubAccessToken) { // If already has access-token, then check if still valid
      THE_GIHUB_COMM.checkAccessToken(req.session.theGithubAccessToken)
        .then(isValid => { // This promise will return false on error. So, it's safe to skip 'catch'
          if (isValid) { // Still valid? then redirect to home with message
            req.session.theFlash = {type: 'msg-info', msg: 'You are already logged-in.'}
            resp.redirect('/')
          } else { // Not valid? then rest old data and re-login
            THE_GIHUB_COMM.initiateLogin(req) // Generate the initiate login URL
              .then(resp.redirect) // Go to github
              .catch(next) // Only the 'crypto' error that we will face here (if that for some reason happened)
          }
        })
    } else { // Else, need github login
      THE_GIHUB_COMM.initiateLogin(req)
        .then(redirectURL => resp.redirect(redirectURL)) // Go to github
        .catch(next) // Only the 'crypto' error that we will face here (if that for some reason happened)
    }
  })

outRouter.route('/login/back') // Github login continuation route (protected by a token to avoid cross-site request forgery)
  .get((req, resp, next) => {
    if (req.session.theLastGithubStateToken && req.session.theLastGithubStateToken === req.query.state) { // If there was a previous state-token and it is equal to the one redirected to us
      THE_GIHUB_COMM.continueLogin(req)
        .then(() => {
          // console.log('vvvvvvvvvvAccTOK')
          // console.log(req.session.theGithubAccessToken)
          // console.log('^^^^^^^^^^')
          req.session.theFlash = {type: 'msg-info', msg: 'Login successful...'}
          resp.redirect('/')
        })
        .catch(next)
    } else { // Else, there is state-token mismatch (most likely cross-site request forgery)
      resp.status(400).render('error/400', {theErrMsg: 'Unsecure login request.'}) // Bad request seems better here (because it's an intended attack and we don't want to give much info)
    }
  })

module.exports = outRouter
