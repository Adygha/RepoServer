/**
 * Handles the '/user' route.
 */

let outRouter = require('express').Router()

outRouter.route('/user')
  .get((req, resp, next) => {
    if (req.session.theUser) {
      resp.render('pages/user', {pageTitle: 'Welcome To Your Repo Page'}) // Just display
    } else {
      resp.status(401).render('error/401', {theErrMsg: 'You have to login or create an account first.'})
    }
  })

module.exports = outRouter
