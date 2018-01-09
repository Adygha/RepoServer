class RepoBuilder {
  /**
   * Default constructor.
   * @param {Object} theUser the User object that contains the user info
   */
  constructor (theUser) {
    this._user = theUser
    this._templates = new Map() // to store extracted html templates
    let tmpURL = new window.URL(theUser.websockPath, window.location.origin)
    tmpURL.protocol = 'wss:'
    this._sock = new WebSocket(tmpURL.href) // TODO: check if posrt is included
    this._sock.addEventListener('message', this._msgReceivedHandler.bind(this))
  }

  /**
   * Requests the initiation of the main page and fill it with this application's issue data.
   */
  initiateMainPage () {
    if (this._sock.readyState === window.WebSocket.OPEN) { // If the websocket connection is open
      this._websocketSend('main-app-issues', '')
    } else { // If the websocket connection is still not open (it is normal, since this is called when the page is just open)
      this._sock.addEventListener('open', () => this._websocketSend('main-app-issues', ''))
    }
  }

  /**
   * Requests the initiation of the user's page and fill it with user's repos' data.
   */
  initiateUserPage () {
    if (this._sock.readyState === window.WebSocket.OPEN) { // If the websocket connection is open
      this._websocketSend('all-user-repos', '')
    } else { // If the websocket connection is still not open (it is normal, since this is called when the page is just open)
      this._sock.addEventListener('open', () => this._websocketSend('all-user-repos', ''))
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
   * Send data using websocket.
   * @param {String} theType the type of the send
   * @param {any} theData the data to send
   */
  _websocketSend (theType, theData) {
    this._sock.send(JSON.stringify({type: theType, content: theData}))
  }

  /**
   * Extract an HTML template content based on template's ID.
   * @param {String} templateID the ID of the template
   * @returns {HTMLElement} the extracted HTML element
   */
  _extractTemplateContent (templateID) {
    if (!this._templates.has(templateID)) { // In not already extracted then extarct
      this._templates.set(templateID, document.getElementById(templateID).content) // Will hold the template content aside
    }
    return document.importNode(this._templates.get(templateID), true)
  }

  /**
   * Creates an HTNL repo representation from the repo object.
   * @param {Object} repoObj the repo object got using github API
   */
  _repoFactory (repoObj) {
    let outRepo = this._extractTemplateContent('repo-template').querySelector('fieldset')
    outRepo.id = 'id' + repoObj.id // Damn it.. I can't use ID with first as digit in CSS3, took me some time..
    outRepo.querySelector('.repo-webhook-choose').addEventListener('change', ev => { // Webhook status change requested
      let tmpMsg = outRepo.querySelector('.repo-little-msg')
      if (tmpMsg.firstElementChild) tmpMsg.removeChild(tmpMsg.firstElementChild)
      this._websocketSend(ev.target.checked ? 'repo-webhook-enable' : 'repo-webhook-disable', outRepo.id.substring(2))
    })
    outRepo.querySelector('legend').textContent = repoObj.name                                //
    outRepo.querySelector('.repo-description').value = repoObj.description                    //
    outRepo.querySelector('.repo-homepage').value = repoObj.homepage                          // Fill repo data
    outRepo.querySelector('.repo-language').value = repoObj.language                          //
    if (repoObj.license) outRepo.querySelector('.repo-license').value = repoObj.license.name  //
    if (repoObj.has_issues && repoObj.theIssues) { // If there is any issue then fill them too
      let tmpIssuesContainer = outRepo.querySelector('.repo-issues-container')
      repoObj.theIssues.forEach(issue => {
        tmpIssuesContainer.appendChild(this._issueFactory(issue))
      })
    }
    return outRepo
  }

  /**
   * Creates an HTNL issue representation from the issue object.
   * @param {Object} issueObj the issue object got using github API
   */
  _issueFactory (issueObj) {
    let outIssue = this._extractTemplateContent('repo-issue-template')
    let tmpCommContainer = outIssue.querySelector('.repo-issue-comments-container') // Will hold the comments
    outIssue.querySelector('legend').textContent = issueObj.title
    outIssue.querySelector('.repo-issuer').value = issueObj.user.login
    outIssue.querySelector('.repo-issue-status').value = issueObj.state
    outIssue.querySelector('.repo-issue-body').textContent = issueObj.body
    if (issueObj.comments > 0 && issueObj.theComments) { // If there is comments, add them too
      issueObj.theComments.forEach(comment => {
        let tmpComm = this._extractTemplateContent('repo-issue-comment-template')
        tmpComm.querySelector('.repo-issue-commenter').textContent = comment.user.login
        tmpComm.querySelector('.repo-issue-comment-body').textContent = comment.body
        tmpCommContainer.appendChild(tmpComm)
      })
    }
    return outIssue
  }

  /**
   * A handler for the web socket 'message' event
   * @param {MessageEvent} theEvent the web socket 'message' event
   */
  _msgReceivedHandler (theEvent) {
    let tmpData = JSON.parse(theEvent.data)
    switch (tmpData.type) {
      case 'all-user-repos': // When, initially, all user's repos' data is requested
        let tmpRepoContainer = document.getElementById('repos-container')
        tmpData.content.forEach(repo => tmpRepoContainer.appendChild(this._repoFactory(repo))) // Add the repo representations
        break
      case 'main-app-issues': // When visiting the main page and requesting this application's issue data
        break
      case 'repo-webhook-enabled':
        let tmpMsgEn = document.createElement('span')
        tmpMsgEn.textContent = 'Webhook status enabled'
        tmpMsgEn.classList.add('repo-msg-info')
        document.querySelector('#id' + tmpData.content + ' .repo-little-msg').appendChild(tmpMsgEn)
        break
      case 'repo-webhook-disabled':
        let tmpMsgDis = document.createElement('span')
        tmpMsgDis.textContent = 'Webhook status disabled'
        tmpMsgDis.classList.add('repo-msg-info')
        document.querySelector('#id' + tmpData.content + ' .repo-little-msg').appendChild(tmpMsgDis)
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
  if (document.location.pathname === '/') { // Choose home or user page
    tmpRepo.initiateMainPage()
  } else {
    tmpRepo.initiateUserPage()
  }
}
