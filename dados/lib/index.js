const fs = require('fs'), os = require('os'), path = require('path'), axios = require('axios'), chalk = require('chalk'), cfonts = require('cfonts')
const { spawn } = require('child_process')
const { WaClient, createStore, ConsoleLogger } = require('zapo-js')
const { sessao } = require('./sessao.js')
const linguagem = require('./menus.js')
const mess = require('./global.js')
const main = require('./main.js')

const logger = new ConsoleLogger('error')

const banner1 = chalk.cyanBright(`
 ██████╗██████╗ ██╗    ██╗    ██████╗  ██████╗ ████████╗
██╔════╝██╔══██╗██║    ██║    ██╔══██╗██╔═══██╗╚══██╔══╝
██║     ██║  ██║██║ █╗ ██║    ██████╔╝██║   ██║   ██║
██║     ██║  ██║██║███╗██║    ██╔══██╗██║   ██║   ██║
╚██████╗██████╔╝╚███╔███╔╝    ██████╔╝╚██████╔╝   ██║
 ╚═════╝╚═════╝  ╚══╝╚══╝     ╚═════╝  ╚═════╝    ╚═╝

                 </> 

`)

const banner2 = chalk.blueBright.bold('dylan modz')

module.exports = {
fs, os, path, axios, chalk, cfonts, spawn,
WaClient, createStore, ConsoleLogger, logger, sessao,
linguagem, mess, main,
...main,
banner1, banner2
}