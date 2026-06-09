const { createLogger, format, transports } = require("winston");
const { combine, timestamp, json, colorize } = format;
const DailyRotateFile = require("winston-daily-rotate-file");
const consoleLogFormat = format.combine(
  format.colorize(),
  format.printf(({ level, message, timestamp }) => {
    return ` ${level}: ${message} `;
  })
);

// Create a Winston logger
const logger = createLogger({
  level: "info",
  format: combine(colorize(), timestamp(), json()),
  transports: [
    new transports.Console({
      format: consoleLogFormat,
    }),
    new DailyRotateFile({
      filename: "logs/app-%DATE%.log", // Log files with date pattern
      datePattern: "YYYY-MM-DD", // Daily rotation
      zippedArchive: false, // Optional: Do not compress logs
      // maxSize: '20m',                    // Optional: Maximum size for a log file
      maxFiles: "30d", // Keep logs for 30 days
    }),

    // Use DailyRotateFile for error log
    new DailyRotateFile({
      filename: "logs/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error", // Log only error messages
      zippedArchive: false, // Optional: Do not compress logs
      // maxSize: '20m',                    // Optional: Maximum size for an error log file
      maxFiles: "30d", // Keep error logs for 30 days
    }),
  ],
});

module.exports = logger;
