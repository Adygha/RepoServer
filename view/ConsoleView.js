const THE_EMIT = require('events')
const THE_QUIT_EV = 'quit'
const THE_RESTART_EV = 'restart'
const THE_TOG_MAINTENANCE_EV = 'tog-maintenance'
const THE_QUIT_COMMAND = 'q'
const THE_RESTART_COMMAND = 'r'
const THE_TOG_MAINTENANCE_COMMAND = 'p'
const THE_WAIT_LINE = 'Waiting for input: '

module.exports = class extends THE_EMIT {
  /**
   * Displays the initial welcome message with some initial help.
   */
  displayWelcomeMessage () {
    process.stdout.write('\x1B[2J')
    this.displayMessage('Welcome. Enter \'%s\' to quit the server, or \'%s\' to re-start it, or \'%s\' to toggle server maintenance mode.',
                        THE_QUIT_COMMAND, THE_RESTART_COMMAND, THE_TOG_MAINTENANCE_COMMAND)
  }

  /**
   * Displays a message line, and handles 'printf' like formattings exactly like 'console.log'
   * @param {any} theMessage the message to be displayed
   * @param {any} optionals some other optional parameters to display
   */
  displayMessage (theMessage, ...theOptionals) {
    // process.stdout.clearLine() // Those two don't work on some consoles
    // process.stdout.cursorTo(0) //
    process.stdout.write('\x1B[2K')   // Those two lines are just to remove 'Waiting for input:' when new message comes
    process.stdout.write('\x1B[1G')   //
    console.log(theMessage, ...theOptionals)
    if (!process.stdin.isPaused()) process.stdout.write(THE_WAIT_LINE)
  }

  /**
   * Starts watching the console input.
   */
  beginWatch () {
    process.once('SIGINT', () => this.emit(THE_QUIT_EV)) // To handle finishing-up when interrupted
    process.stdin.resume().addListener('data', buf => {
      let tmpStr = buf.toString().trim()
      switch (tmpStr) {
        case THE_QUIT_COMMAND:
          this.emit(THE_QUIT_EV)
          break
        case THE_RESTART_COMMAND:
          this.emit(THE_RESTART_EV)
          break
        case THE_TOG_MAINTENANCE_COMMAND:
          this.emit(THE_TOG_MAINTENANCE_EV)
          break
        default:
          process.stdout.write('Invalid input.\n' + THE_WAIT_LINE)
      }
    })
  }

  /**
   * Stops watching the console input.
   */
  endWatch () {
    process.stdin.removeAllListeners('data').pause()
  }
}
