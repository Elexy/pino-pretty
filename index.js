'use strict'

const chalk = require('chalk')
const joda = require('js-joda')
const jsonParser = require('fast-json-parse')

joda.use(require('js-joda-timezone'))
joda.use(require('js-joda-locale'))

const levels = {
  default: 'USERLVL',
  60: 'FATAL',
  50: 'ERROR',
  40: 'WARN',
  30: 'INFO',
  20: 'DEBUG',
  10: 'TRACE'
}

const defaultOptions = {
  colorize: false,
  crlf: false,
  dateFormat: 'yyyy-MM-dd HH:mm:ss.SSS Z',
  errorLikeObjectKeys: ['err', 'error'],
  errorProps: '',
  levelFirst: false,
  localTime: false,
  messageKey: 'msg',
  translateTime: false
}

function isPinoLog (log) {
  return log && (log.hasOwnProperty('v') && log.v === 1)
}

function formatTime (epoch, formatString, localTime) {
  const instant = joda.Instant.ofEpochMilli(epoch)
  const zonedDateTime = joda.ZonedDateTime.ofInstant(
    instant,
    localTime ? joda.ZoneOffset.SYSTEM : joda.ZoneOffset.UTC
  )
  const formatter = joda.DateTimeFormatter.ofPattern(formatString)
  try {
    return formatter.format(zonedDateTime)
  } catch (e) {
    return epoch
  }
}

function nocolor (input) {
  return input
}

module.exports = function prettyFactory (options) {
  const opts = Object.assign({}, defaultOptions, options)
  const EOL = opts.crlf ? '\r\n' : '\n'
  const IDENT = '    '
  const messageKey = opts.messageKey
  const errorLikeObjectKeys = opts.errorLikeObjectKeys
  const errorProps = opts.errorProps.split(',')

  const color = {
    default: nocolor,
    60: nocolor,
    50: nocolor,
    40: nocolor,
    30: nocolor,
    20: nocolor,
    10: nocolor
  }
  if (opts.colorize) {
    const ctx = new chalk.constructor({enabled: true})
    color.default = ctx.white
    color[60] = ctx.bgRed
    color[50] = ctx.red
    color[40] = ctx.yellow
    color[30] = ctx.green
    color[20] = ctx.blue
    color[10] = ctx.grey
  }

  return function pretty (inputLine) {
    const parsed = jsonParser(inputLine)
    const log = parsed.value
    if (parsed.err || !isPinoLog(log)) {
      // pass through
      return inputLine + EOL
    }

    const standardKeys = [
      'pid',
      'hostname',
      'name',
      'level',
      'time',
      'v'
    ]

    if (opts.translateTime) {
      log.time = formatTime(log.time, opts.dateFormat, opts.localTime)
    }

    var line = `[${log.time}]`

    const coloredLevel = levels.hasOwnProperty(log.level)
      ? color[log.level](levels[log.level])
      : color.default(levels.default)
    if (opts.levelFirst) {
      line = `${coloredLevel} ${line}`
    } else {
      line = `${line} ${coloredLevel}`
    }

    if (log.name || log.pid || log.hostname) {
      line += ' ('

      if (log.name) {
        line += log.name
      }

      if (log.name && log.pid) {
        line += '/' + log.pid
      } else if (log.pid) {
        line += log.pid
      }

      if (log.hostname) {
        line += ' on ' + log.hostname
      }

      line += ')'
    }

    line += ': '

    if (log[messageKey]) {
      line += log[messageKey]
    }

    line += EOL

    if (log.type === 'Error') {
      line += IDENT + joinLinesWithIndentation(log.stack) + EOL

      let propsForPrint
      if (errorProps && errorProps.length > 0) {
        // don't need print these props for 'Error' object
        const excludedProps = standardKeys.concat([messageKey, 'type', 'stack'])

        if (errorProps[0] === '*') {
          // print all log props excluding 'excludedProps'
          propsForPrint = Object.keys(log).filter((prop) => excludedProps.indexOf(prop) < 0)
        } else {
          // print props from 'errorProps' only
          // but exclude 'excludedProps'
          propsForPrint = errorProps.filter((prop) => excludedProps.indexOf(prop) < 0)
        }

        for (var i = 0; i < propsForPrint.length; i++) {
          const key = propsForPrint[i]
          if (!log.hasOwnProperty(key)) continue
          if (log[key] instanceof Object) {
            // call 'filterObjects' with 'excludeStandardKeys' = false
            // because nested property might contain property from 'standardKeys'
            line += key + ': {' + EOL + filterObjects(log[key], '', errorLikeObjectKeys, false) + '}' + EOL
            continue
          }
          line += key + ': ' + log[key] + EOL
        }
      }
    } else {
      line += filterObjects(log, messageKey, errorLikeObjectKeys)
    }

    return line

    function joinLinesWithIndentation (value) {
      const lines = value.split(/\r?\n/)
      for (var i = 1; i < lines.length; i++) {
        lines[i] = IDENT + lines[i]
      }
      return lines.join(EOL)
    }

    function filterObjects (value, messageKey, errorLikeObjectKeys, excludeStandardKeys) {
      errorLikeObjectKeys = errorLikeObjectKeys || []

      const keys = Object.keys(value)
      const filteredKeys = [messageKey]

      if (excludeStandardKeys !== false) {
        Array.prototype.push.apply(filteredKeys, standardKeys)
      }

      let result = ''

      for (var i = 0; i < keys.length; i += 1) {
        if (errorLikeObjectKeys.indexOf(keys[i]) !== -1) {
          const arrayOfLines = (
            IDENT + keys[i] + ': ' +
            joinLinesWithIndentation(JSON.stringify(value[keys[i]], null, 2)) +
            EOL
          ).split('\n')

          for (var j = 0; j < arrayOfLines.length; j += 1) {
            if (j !== 0) {
              result += '\n'
            }

            const line = arrayOfLines[j]

            if (/^\s*"stack"/.test(line)) {
              const matches = /^(\s*"stack":)\s*"(.*)",?$/.exec(line)

              if (matches && matches.length === 3) {
                const indentSize = /^\s*/.exec(line)[0].length + 4
                const indentation = Array(indentSize + 1).join(' ')

                result += matches[1] + '\n' + indentation + matches[2].replace(/\\n/g, '\n' + indentation)
              }
            } else {
              result += line
            }
          }
        } else if (filteredKeys.indexOf(keys[i]) < 0) {
          result += IDENT + keys[i] + ': ' + joinLinesWithIndentation(JSON.stringify(value[keys[i]], null, 2)) + EOL
        }
      }

      return result
    }
  }
}