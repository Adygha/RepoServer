/*
 * A module that helps getting the responses for the HTTP(s) requests as promises (from previous assignment 1).
 */

const THE_HTTPS = require('https')
const THE_HTTP = require('http')
const THE_URL = require('url') // Just to resolve URLs correctly

module.exports = {

  /**
   * A GET HTTP method that uses promise.
   * @param {String} theURL the URL to run GET against
   * @param {String} theHeaders the additional headers if needed
   * @returns {Promise<Buffer>} a promise that holds the response payload data and the last URL used
   */
  promGET: function (theURL, theHeaders) {
    return new Promise((resolve, reject) => {
      let tmpURL = THE_URL.parse(theURL)
      let tmpProt
      if (theURL.startsWith('https')) {
        tmpProt = THE_HTTPS
      } else if (theURL.startsWith('http')) {
        tmpProt = THE_HTTP
      } else {
        return reject(new Error('The URL must be a full HTTP(s) URL.'))
      }
      tmpProt.get({protocol: tmpURL.protocol, hostname: tmpURL.hostname, port: tmpURL.port, path: tmpURL.path, headers: theHeaders}, resp => { // A GET request using options
        if (resp.statusCode === 200) { // The normal response
          let tmpPayLoad = []
          resp.addListener('data', ch => tmpPayLoad.push(ch)).once('end', () => resolve(Buffer.concat(tmpPayLoad))) // Resolve the payload
        } else if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) { // In case there was a redirection
          // In case the redirection is to a full URL path or not, we'll resolve the location
          this.promGET(THE_URL.parse(resp.headers.location).hostname ? resp.headers.location : THE_URL.resolve(theURL, resp.headers.location))
            .then(resolve)
            .catch(err => reject(err))
        } else { // Any other uninteresting response (we don't want this in our assignment)
          return reject(new Error('The server targeted in the URL responded with an uninteresting response with a status-code: ' + resp.statusCode))
        }
      }).once('error', err => reject(err))
    })
  },

  /**
   * A POST HTTP method that uses promise.
   * @param {String} theURL the URL to run POST against
   * @param {String} theData the data to be sent with POST
   * @param {String} theHeaders the additional headers if needed
   * @returns {Promise<Buffer>} a promise that holds the response payload data if any and the last URL used
   */
  promPOST: function (theURL, theData, theHeaders) {
    return new Promise((resolve, reject) => {
      let tmpURL = THE_URL.parse(theURL)
      let tmpProt
      if (theURL.startsWith('https')) {
        tmpProt = THE_HTTPS
      } else if (theURL.startsWith('http')) {
        tmpProt = THE_HTTP
      } else {
        return reject(new Error('The URL must be a full HTTP(s) URL.'))
      }
      theHeaders['content-type'] = 'application/x-www-form-urlencoded'
      tmpProt.request({method: 'POST', protocol: tmpURL.protocol, hostname: tmpURL.hostname, port: tmpURL.port, path: tmpURL.path, headers: theHeaders}, resp => { // A POST request using options
        if (resp.statusCode === 200) { // In case there was a direct content for the result of POST
          let tmpPayLoad = []
          resp.addListener('data', ch => tmpPayLoad.push(ch)).once('end', () => resolve(Buffer.concat(tmpPayLoad))) // Resolve the payload
        } else if (resp.statusCode === 201 || resp.statusCode === 204) { // In case of Created or No-Content
          resolve('') // if 201, we may have to inform about the newly created resourse location (but no need now)
        } else if (resp.statusCode >= 301 && resp.statusCode <= 303 && resp.headers.location) { // In case we should repeat with GET
          // In case the redirection is to a full URL path or not, we'll resolve the location
          let tmpCookie = resp.headers['set-cookie'] ? resp.headers['set-cookie'][0].split(';', 1)[0] : '' // Extract the requested cookie if requested
          this.promGET(THE_URL.parse(resp.headers.location).hostname ? resp.headers.location : THE_URL.resolve(theURL, resp.headers.location), tmpCookie)
            .then(resolve)
            .catch(err => reject(err))
        } else if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) { // In other 3xx cases with a location, then there was a redirection and we have to repeat with POST on redirection
          // In case the redirection is to a full URL path or not, we'll resolve the location
          let tmpCookie = resp.headers['set-cookie'] ? resp.headers['set-cookie'][0].split(';', 1)[0] : '' // Extract the requested cookie if requested
          this.promPOST(THE_URL.parse(resp.headers.location).hostname ? resp.headers.location : THE_URL.resolve(theURL, resp.headers.location), theData, tmpCookie)
            .then(resolve)
            .catch(err => reject(err)) // Recursive call to the redirected URL
        } else { // Any other uninteresting response (we don't want this in our assignment)
          return reject(new Error('The server targeted in the URL responded with an uninteresting response with a status-code: ' + resp.statusCode))
        }
      }).once('errot', err => reject(err)).end(theData)
    })
  },

  /**
   * Just passes the Nide.js 'url.resolve' method/funnction outside this module
   * @param {String} theURL the main url (from)
   * @param {String} theSub the addition (to)
   * @returns {String} the newly built URL
   */
  urlResolve: function (theURL, theSub) {
    return THE_URL.resolve(theURL, theSub)
  },

  /**
   * Just passes the Nide.js 'url.format' method/funnction outside this module
   * @param {String} urlObject the URL object that contains the query
   * @returns {String} the newly built URL with query string
   */
  urlFormat: function (urlObject) {
    return THE_URL.format(urlObject)
  }
}
