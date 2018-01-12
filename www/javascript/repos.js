class RepoBuilder {
  /**
   * Default constructor.
   * @param {String} websockPath the websocker relative path
   */
  constructor (websockPath) {
    this._templates = new Map() // to store extracted html templates
    this._repos = new Map() // to store fetched repos
    let tmpURL = new window.URL(websockPath, window.location.origin) // The full URL
    tmpURL.protocol = 'wss:'
    this._sock = new window.WebSocket(tmpURL.href)
    this._sock.addEventListener('message', this._msgReceivedHandler.bind(this))
  }

  /**
   * Requests the initiation of the main page and fill it with this application's issue data.
   */
  initiateMainPage () {
    this._isMainPage = true
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
    this._isMainPage = false
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
      this._repos.forEach((repo, id) => {
        if (repo.theWebHook) this._websocketSend('repo-webhook-disable', {id, hooksURL: repo.theWebHook.url, needResponse: false})
      })
      this._sock.close(1000, 'Closing normally on request.') // Just following documentations for normal behaviour
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
    let tmpSelect = outRepo.querySelector('.repo-webhook-choose')
    tmpSelect.checked = !!repoObj.theWebHook
    outRepo.id = 'id' + repoObj.id // Damn it.. I can't use ID with first as digit in CSS3, took me some time..
    tmpSelect.addEventListener('change', ev => { // Webhook status change requested
      let tmpMsg = outRepo.querySelector('.repo-webhook-choose-msg-container')
      if (tmpMsg.firstElementChild) tmpMsg.removeChild(tmpMsg.firstElementChild)
      if (ev.target.checked || (!ev.target.checked && repoObj.theWebHook)) { // If able to change repo webhook
        this._websocketSend(ev.target.checked ? 'repo-webhook-enable' : 'repo-webhook-disable', {
          id: repoObj.id,
          hooksURL: ev.target.checked ? repoObj.hooks_url : repoObj.theWebHook.url, // Send the url depending on checked
          needResponse: true
        })
      } else {
        let tmpMsgCont = document.createElement('span')
        tmpMsgCont.textContent = 'A webhook for this repo cannot be created/deleted'
        tmpMsgCont.classList.add('repo-msg-info')
        tmpMsg.appendChild(tmpMsgCont)
      }
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
        if (tmpData.content.length > 0) {
          tmpData.content.forEach(repo => { // Add the repo representations
            this._repos.set(repo.id, repo)
            tmpRepoContainer.appendChild(this._repoFactory(repo))
          })
        } else {
          tmpRepoContainer.textContent = 'No repos to show.'
        }
        break
      case 'main-app-issues': // When visiting the main page and requesting this application's issue data
        let tmpIssuesContainer = document.getElementById('issues-container')
        while (tmpIssuesContainer.firstChild) tmpIssuesContainer.removeChild(tmpIssuesContainer.firstChild) // Remove all children if any
        if (tmpData.content.length > 0) {
          tmpData.content.forEach(issue => tmpIssuesContainer.appendChild(this._issueFactory(issue)))
        } else {
          tmpIssuesContainer.textContent = 'No issues to show.'
        }
        break
      case 'repo-webhook-enabled':
        let tmpMsgEn = document.createElement('span')
        tmpMsgEn.textContent = 'Webhook status enabled'
        tmpMsgEn.classList.add('repo-msg-info')
        this._repos.get(tmpData.content.id).theWebHook = tmpData.content.theWebHook
        document.querySelector('#id' + tmpData.content.id + ' .repo-webhook-choose-msg-container').appendChild(tmpMsgEn)
        break
      case 'repo-webhook-disabled':
        let tmpMsgDis = document.createElement('span')
        tmpMsgDis.textContent = 'Webhook status disabled'
        tmpMsgDis.classList.add('repo-msg-info')
        delete this._repos.get(tmpData.content.id).theWebHook // Remove the webhook from repo
        document.querySelector('#id' + tmpData.content.id + ' .repo-webhook-choose-msg-container').appendChild(tmpMsgDis)
        break
      case 'main-app-event': // When main app repo event recieved
        this._displayMessage(
          'An event recieved that ' + tmpData.content.event + ' was/were ' + tmpData.content.body.action + '. Please ' +
          (this._isMainPage ? 'refresh this page if it doesn\'t auto-refresh.' : 'visit main page to get the updates.')
        )
        // Next, prepare a message/anchor to show that main app's repo issues are changed and scroll to message
        let tmpRefrAnch = document.body.querySelector('.main-repo-message-anchor')
        let removableMainHandler = (ev) => {
          tmpRefrAnch.removeEventListener('click', removableMainHandler) // Only once
          ev.preventDefault()
          tmpRefrAnch.style.visibility = 'hidden'
          this._websocketSend('main-app-issues', '')
        }
        tmpRefrAnch.addEventListener('click', removableMainHandler)
        tmpRefrAnch.style.visibility = 'visible'
        tmpRefrAnch.scrollIntoView(true)
        break
      case 'user-repos-event': // When user repo event recieved
        this._displayMessage(
          'An event ' + tmpData.content.event + ' was recieved that the repo ' + tmpData.content.body.repository.name +
          ' was changed. Please refresh the repo if it doesn\'t auto-refresh.'
        )
        // Next, prepare a message/anchor to show that this specific repo is changed and scroll to it
        let tmpRefAnch = document.body.querySelector('#id' + tmpData.content.body.repository.id + ' .repo-message-anchor')
        let removableHandler = (ev) => {
          tmpRefAnch.removeEventListener('click', removableHandler) // Only once
          ev.preventDefault()
          tmpRefAnch.style.visibility = 'hidden'
          this._websocketSend('user-repo-update', {repoURL: tmpData.content.body.repository.url})
        }
        tmpRefAnch.addEventListener('click', removableHandler)
        tmpRefAnch.style.visibility = 'visible'
        tmpRefAnch.parentElement.scrollIntoView(true)
        break
      case 'user-repo-updated':
        let tmpUpdatedRepo = this._repoFactory(tmpData.content)
        // this._repos.set(tmpData.content.id, tmpData.content)
        if (this._repos.get(tmpData.content.id).theWebHook) {
          tmpData.content.theWebHook = this._repos.get(tmpData.content.id).theWebHook // Assign the webhook (if any) to new object
        }
        document.getElementById('repos-container').replaceChild(tmpUpdatedRepo, document.getElementById('id' + tmpData.content.id)) // Replace old one
        break
      case 'error': // In case an error
        this._displayMessage(tmpData.message, true)
        break
      case 'ping': // Nothing for now
        // console.log('ping')
    }
  }

  /**
   * Displays a temporary message to the user.
   * @param {String} theMsg the message to display
   * @param {Boolean} isError true to display as error message
   */
  _displayMessage (theMsg, isError) {
    // window.scrollTo(0, 0)
    let tmpHeader = document.body.querySelector('header')
    let tmpMsg = tmpHeader.querySelector('[class^="msg-"]')
    if (tmpMsg) tmpHeader.removeChild(tmpMsg) // Delete old one
    tmpMsg = document.createElement('div')
    tmpMsg.classList.add(isError ? 'msg-err' : 'msg-info')
    tmpMsg.textContent = theMsg
    tmpHeader.insertBefore(tmpMsg, tmpHeader.firstChild)
  }
}

startUp()

function startUp () {
  let tmpWsPath = document.getElementById('the-hidden').value.trim() // There is another way to do this, but it violate the standard
  let tmpRepo = new RepoBuilder(tmpWsPath)
  window.addEventListener('beforeunload', function removableHandler (ev) { // The websocket is normally closed when the page closes or the page is left, but just in case it didn't
    // window.removeEventListener('beforeunload', removableHandler) // Only one time (maybe needed)
    tmpRepo.closeConnection()
  })
  if (document.location.pathname === '/') { // Choose home or user page
    tmpRepo.initiateMainPage()
  } else {
    tmpRepo.initiateUserPage()
  }
}
