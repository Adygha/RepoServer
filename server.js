/*
 * Just a start-up point
 */

const Controller = require('./controller/RepoServer')

startUp()

function startUp () {
  let tmpController = new Controller()
  tmpController.startServer()
}
