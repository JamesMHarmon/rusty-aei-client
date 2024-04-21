const yarg = require('yargs');
const readline = require('readline');
const WebSocket = require('ws');
const { version } = require('./package.json');

/* eslint-disable indent */
const { _: args, url, token } = yarg
	.usage('Usage: -t <token>')
	.version(version)
	.option('t', { alias: 'token', describe: 'Your token', type: 'string', demandOption: false })
	.option('u', { alias: 'url', describe: 'ugi remote endpoint', default: 'ws://45.79.196.77:8080', type: 'string', demandOption: false })
	.check(({ _, token }) => {
		if (!token) {
			throw new Error('A token must be supplied with the -t flag');
		}

		if (!token.startsWith('rbt_') || token.length != 36) {
			throw new Error(`The supplied token is not valid: ${token}`);
		}

		return true;
	})
	.argv;
/* eslint-enable indent */

const excludes = /^log Debug: search visits|^info time|^info root_score|^info root_transpositionid|^info transpositionid/;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const ws = new WebSocket(url);

let bufferedInput = [];
rl.on('line', (input) => {
	input = input.trim();
	if (input) {
		if (ws.isAlive) {
			ws.send(input);
		} else {
			bufferedInput.push(input);
		}
	}
});

ws.on('open', function open() {
	console.log('log Debug: Connection Opened');
	ws.send(JSON.stringify({
		token,
		version
	}));

	ws.isAlive = true;

	bufferedInput.forEach((input) => ws.send(input));

	bufferedInput.length = 0;
});

ws.on('message', function message(data) {
	data = data + '';

	if (!excludes.test(data)) {
		console.log(data);
	}

	if (data.startsWith('log Error:')) {
		ws.close();
	}
});

ws.on('close', () => {
	ws.isAlive = false;
	console.log('log Debug: Connection Closed');
	rl.close();
});
