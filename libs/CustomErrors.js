/*
 * A module that is essentially classes that represent custom errors that can be
 * filtered for example.
 */

/**
 * An abstract custom error class that is the super for some custom errors.
 * @class
 */
class AbstractCustomError extends Error { // May not need this (may delete if it will not provide a basic functionality)
  constructor (...args) {
    super(...args)
    if (new.target === AbstractCustomError) {
      throw new TypeError('The \'AbstractCustomError\' class is an abstract class and cannot be instantiated.')
    }
    // if (Error.captureStackTrace) Error.captureStackTrace(this, AbstractCustomError) // Recommended for tracking stack with this error
  }
}

class InvalidHttpParamError extends AbstractCustomError {
  constructor (...args) {
    super(...args)
    if (Error.captureStackTrace) Error.captureStackTrace(this, InvalidHttpParamError) // Recommended for tracking stack with this error
  }
}

class DatabaseNotAvailableError extends AbstractCustomError {
  constructor (...args) {
    super(...args)
    if (Error.captureStackTrace) Error.captureStackTrace(this, DatabaseNotAvailableError) // Recommended for tracking stack with this error
  }
}

class UnderMaintenanceError extends AbstractCustomError {
  constructor (...args) {
    super(...args)
    if (Error.captureStackTrace) Error.captureStackTrace(this, UnderMaintenanceError) // Recommended for tracking stack with this error
  }
}

module.exports = {
  AbstractCustomError,
  InvalidHttpParamError,
  DatabaseNotAvailableError,
  UnderMaintenanceError
}
