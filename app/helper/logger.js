const { createLogger, format, transports } = require("winston");
const { combine, timestamp, json, colorize } = format;
const DailyRotateFile = require("winston-daily-rotate-file");
const consoleLogFormat = format.combine(
  format.colorize(),
  format.printf(({ level, message, timestamp }) => {
    return ` ${level}: ${message} `;
  })
);

const isServerless = !!(
    process.env.VERCEL ||
    process.env.RENDER ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
);

const loggerTransports = [
  new transports.Console({
    format: consoleLogFormat,
  }),
];

if (!isServerless) {
  loggerTransports.push(
    new DailyRotateFile({
      filename: "logs/app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: false,
      maxFiles: "30d",
    }),
    new DailyRotateFile({
      filename: "logs/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error",
      zippedArchive: false,
      maxFiles: "30d",
    })
  );
}

const logger = createLogger({
  level: "info",
  format: combine(colorize(), timestamp(), json()),
  transports: loggerTransports,
});

module.exports = logger;
