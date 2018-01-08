class RepoBuilder {
  constructor (theUser) {
    this._user = theUser
    let tmpURL = new window.URL(theUser.websockPath, window.location.origin)
    tmpURL.protocol = 'wss:'
    this._sock = new window.WebSocket(tmpURL.href) // TODO: check if posrt is included
    this._sock.addEventListener('message', this._msgReceivedHandler.bind(this))
    this._repoContainer = document.getElementById('repos-container')
  }

  /**
   * Requests the initiation of the main page and fill it with this application's issue data.
   */
  initiateMainPage () {
  }

  /**
   * Requests the initiation of the user's page and fill it with user's repos' data.
   */
  initiateUserPage () {
    if (this._sock.readyState === window.WebSocket.OPEN) {
      this._sock.send(JSON.stringify({type: 'all-user-repos'}))
    } else {
      this._sock.addEventListener('open', () => this._sock.send(JSON.stringify({type: 'all-user-repos'})))
    }
  }

  /**
   * Closes the websocket connection (The websocket is normally closed when the page closes or
   * the page is left, but just in case it didn't, or if we want toclose on demand).
   */
  closeConnection () {
    if (this._sock && this._sock.readyState !== window.WebSocket.CLOSED) {
      this._sock.close(1000, 'Closing normally on request.')
    }
  }

  /**
   * Extract an HTML template content based on template's ID.
   * @param {String} templateID the ID of the template
   * @returns {HTMLElement} the extracted HTML element
   */
  _extractTemplateContent (templateID) {
    let tmpCont = document.getElementById(templateID)
    return document.importNode(tmpCont.content, true).firstElementChild
  }

  /**
   * Creates an HTNL repo representation from the repo object.
   * @param {Object} repoObj the repo object get using github API
   */
  _repoFactory (repoObj) {
    let outRepo = this._extractTemplateContent('repo-template')
    outRepo.querySelector('legend').textContent = repoObj.name                                //
    outRepo.querySelector('.repo-description').value = repoObj.description                    //
    outRepo.querySelector('.repo-homepage').value = repoObj.homepage                          // Fill repo data
    outRepo.querySelector('.repo-language').value = repoObj.language                          //
    if (repoObj.license) outRepo.querySelector('.repo-license').value = repoObj.license.name  //
    if (repoObj.has_issues) { // If there is any issue then fill them too
    }
    return outRepo
  }

  /**
   * A handler for the web socket 'message' event
   * @param {MessageEvent} theEvent the web socket 'message' event
   */
  _msgReceivedHandler (theEvent) {
    let tmpData = JSON.parse(theEvent.data)
    switch (tmpData.type) {
      case 'all-user-repos': // When, initially, all user's repos' data is requested
        tmpData.content.forEach(repo => this._repoContainer.appendChild(this._repoFactory(repo))) // Add the repo representations
        break
      case 'main-app-issues': // When visiting the main page and requesting this application's issue data
        break
      case 'error': // In case an error (TODO: may delete)
    }
  }
}

startUp()

function startUp () {
  let tmpUser = JSON.parse(decodeURIComponent(document.getElementById('the-hidden').value)) // There is another way to do this, but it violate the standard
  // if (tmpUser) window.alert(tmpUser.displayName || tmpUser.userName)
  let tmpRepo = new RepoBuilder(tmpUser)
  document.addEventListener('beforeunload', function removableHandler (ev) { // The websocket is normally closed when the page closes or the page is left, but just in case it didn't
    document.removeEventListener('beforeunload', removableHandler) // Only one time
    tmpRepo.closeConnection()
  })
  tmpRepo.initiateUserPage() // TODO: Make a choice for home or user page
}
