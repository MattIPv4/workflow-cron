const path = require('path');
require('dotenv').config({ path: path.join(__dirname, `${process.env.NODE_ENV}.env`) });
const WorkersSentryWebpackPlugin = require('workers-sentry/webpack');

module.exports = {
    entry: './src/index.js',
    plugins: [
        // Publish source maps to Sentry on each build
        new WorkersSentryWebpackPlugin(
            process.env.SENTRY_AUTH_TOKEN,
            process.env.SENTRY_ORG,
            process.env.SENTRY_PROJECT,
        ),
    ],
    module: {
        rules: [
            {
                test: /\.ya?ml$/,
                type: 'json',
                use: 'yaml-loader',
            },
        ],
    },
};
