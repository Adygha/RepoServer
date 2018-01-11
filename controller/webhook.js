/**
 * Handles the '/webhook' route that deals with github's webhooks.
 */

const THE_SEC_CONF = require('../config/secConf')
const THE_GIHUB_COMM = require('../view/githubComm')()
const THE_CRYPT = require('crypto')

let outRouter = require('express').Router()

outRouter.route('/webhook')
  .get((req, resp, next) => {
    resp.sendStatus(200)
  })
  .post((req, resp, next) => {
    let tmpSecHeader = req.header('x-hub-signature').split('=')
    let tmpAppToChk = THE_CRYPT.createHmac(tmpSecHeader[0], THE_SEC_CONF.githubAppWebHookSecret).update(JSON.stringify(req.body)).digest('hex')
    let tmpUserToChk = THE_CRYPT.createHmac(tmpSecHeader[0], THE_SEC_CONF.githubUserWebHookSecret).update(JSON.stringify(req.body)).digest('hex')
    if (req.header('x-github-event') === 'ping' && (tmpSecHeader[1] === tmpAppToChk || tmpSecHeader[1] === tmpUserToChk)) {
      resp.sendStatus(200) // Just send an ok on ping
    } else if (tmpSecHeader[1] === tmpAppToChk) {
      THE_GIHUB_COMM.websocketBroadcast(JSON.stringify({ // Broadcast the event data
        type: 'main-app-event',
        content: {event: req.header('x-github-event'), body: req.body}
      }))
      resp.sendStatus(200) // Gihub only needs this
    } else if (tmpSecHeader[1] === tmpUserToChk) {
      THE_GIHUB_COMM.websocketSend(JSON.stringify({ // Send to single socket/user
        type: 'user-repos-event',
        content: {event: req.header('x-github-event'), body: req.body}
      }), req.body.repository.owner.id)
      resp.sendStatus(200) // Gihub only needs this
    } else {
      resp.sendStatus(400) // Check failed
    }
  })

module.exports = outRouter
