let outRouter = require('express').Router()

outRouter.route('/')
  .get((req, resp, next) => {
    resp.render('pages/home', {pageTitle: 'Welcome to Repo Server'})
  })

module.exports = outRouter
