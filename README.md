## A Node.js Github Repository API WebHook Server assignment for the 1DV523 course at Linnaeus University


To use, a secure config file 'config/secConf.js' should be provided with specified and github-app's info like this:

```
module.exports = {
  appName: 'Repo-Server',
  sessOption: { // The session options
    name: 'some session name',
    secret: 'some session secret',
    resave: false,
    saveUninitialized: false,
    cookie: {maxAge: 10 * 365 * 24 * 60 * 60}
  },
  dbURL: 'mongodb://mongodb-url', // mlab
  githubAppExamRepoToken: 'github app exam repo token',
  githubAppClientID: 'github app client ID',
  githubAppClientSecret: 'github app client secret',
  githubAppWebHookSecret: 'github app WebHook secret',
  githubUserWebHookSecret: 'github user WebHook secret',
  githubAppExamRepoID: 999999999
}
```
