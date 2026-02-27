const chalk = require('chalk');
const gradient = require('gradient-string');
const config = require('../core_settings/config.json');
const Table = require('cli-table3');
const stringWidth = require('string-width');

const logLevels = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  verbose: 4
};

const currentLevel = logLevels[config.logging.level] || logLevels.info;

const asciiArt = `
 ██╗   ██╗ ██╗██████╗         ███╗   ██╗███████╗    ██████╗ 
 ██║   ██║███║╚════██╗        ████╗  ██║╚══███╔╝    ██╔══██╗
 ██║   ██║╚██║ █████╔╝█████╗  ██╔██╗ ██║  ███╔╝     ██████╔╝
 ╚██╗ ██╔╝ ██║██╔═══╝ ╚════╝  ██║╚██╗██║ ███╔╝      ██╔══██╗
  ╚████╔╝  ██║███████╗        ██║ ╚████║███████╗    ██║  ██║
   ╚═══╝   ╚═╝╚══════╝        ╚═╝  ╚═══╝╚══════╝    ╚═╝  ╚═╝
`;

const colors = {
  primary: chalk.cyan.bold,
  secondary: chalk.magenta,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  verbose: chalk.gray,
  timestamp: chalk.white.dim,
  border: chalk.blueBright,
  header: chalk.cyan
};

const levelColors = {
  error: colors.error,
  warn: colors.warning,
  info: colors.info,
  verbose: colors.verbose
};

function getTerminalWidth() {
  return process.stdout.columns || 80;
}

function centerText(text, width) {
  const terminalWidth = width || getTerminalWidth();
  const lines = text.split('\n');
  return lines.map(line => {
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
    const textWidth = stringWidth(cleanLine);
    const padding = Math.max(0, Math.floor((terminalWidth - textWidth) / 2));
    return ' '.repeat(padding) + line;
  }).join('\n');
}

function formatTimestamp() {
  const now = new Date();
  const bdTime = new Date(now.getTime() + (6 * 60 * 60 * 1000));
  return bdTime.toISOString().replace('T', ' ').substring(0, 19);
}

function displayStartupBanner() {
  const terminalWidth = getTerminalWidth();
  const width = Math.min(terminalWidth, 80);
  
  // Responsive ASCII scaling: If terminal is too small, use a simpler version or scale down
  let displayArt = asciiArt;
  if (terminalWidth < 60) {
    displayArt = 'V12 - NZ - R';
  }

  console.log('\n' + centerText(gradient.pastel.multiline(displayArt), terminalWidth));
  
  const hr = colors.border('━'.repeat(Math.max(0, width - 4)));
  console.log(centerText(hr, terminalWidth));
  
  console.log(centerText(colors.info('✨ A sophisticated Facebook Messenger System ✨'), terminalWidth));
  console.log(centerText(colors.secondary('Crafted with Passion by NZ R'), terminalWidth));
  console.log(centerText(colors.success('Status: Operational | Version: 1.2.0'), terminalWidth));
  
  console.log(centerText(hr, terminalWidth) + '\n');
}

function formatMessageLog(context, senderName, senderId, message, threadId, groupName, messageType = 'TEXT', mediaUrl = null) {
  const timestamp = formatTimestamp();
  const width = Math.min(getTerminalWidth() - 4, 70);

  const table = new Table({
    wordWrap: true,
    wrapOnWordBoundary: false,
    colWidths: [12, width - 15],
    style: { border: ['white'], head: ['white'] },
    chars: {
      'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
      'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
      'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
      'right': '║', 'right-mid': '╢', 'middle': '│'
    }
  });

  table.push(
    [{ colSpan: 2, content: colors.timestamp(`[${timestamp}] Message Received`), hAlign: 'center' }],
    [colors.info('Context'), colors.primary(context)],
    [colors.info(context === 'GROUP' ? 'Group' : 'Thread'), colors.secondary(context === 'GROUP' ? `${groupName}\nID: ${threadId}` : threadId)],
    [colors.info('Sender'), colors.success(`${senderName}\nID: ${senderId}`)],
    [colors.info('Content'), colors.primary(message || '(no text content)')],
    [colors.info('Type'), colors.warning(messageType)]
  );

  if (mediaUrl) {
    table.push([colors.info('Media'), colors.primary(mediaUrl)]);
  }

  return '\n' + table.toString() + '\n';
}

function log(level, message, isSystemLog = true) {
  if (logLevels[level] <= currentLevel) {
    if (isSystemLog) {
      const timestamp = formatTimestamp();
      const levelText = levelColors[level](`[${level.toUpperCase()}]`);
      const logMsg = `${colors.timestamp(`[${timestamp}]`)} ${levelText} ${colors.primary(message)}`;
      console.log(logMsg);
    } else {
      console.log(message);
    }
  }
}

module.exports = {
  error: (message) => log('error', message),
  warn: (message) => log('warn', message),
  info: (message) => log('info', message),
  verbose: (message) => log('verbose', message),
  messageLog: (context, senderName, senderId, message, threadId, groupName, messageType, mediaUrl, messageID) => {
    const formattedLog = formatMessageLog(context, senderName, senderId, message, threadId, groupName, messageType, mediaUrl);
    log('info', formattedLog, false);
  },
  displayStartupBanner,
  formatTimestamp
};
