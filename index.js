const yarg = require('yargs');
const readline = require('readline');
const WebSocket = require('ws');
const fs = require('fs/promises');

const MAX_VISITS = 5000000;

let isAnalyzeMode = false;
let isAnalyzeComplete = false;

/* eslint-disable indent */
const options = yarg
	.usage('Usage: -t <token>')
	// .command('aei')
	.command('aei')
	.command('analyze <move_file>')
	.option('t', { alias: 'token', describe: 'Your token', type: 'string', demandOption: false })
	.option('u', { alias: 'url', describe: 'Rusty remote endpoint', default: 'ws://localhost:8080', type: 'string', demandOption: false })
	.demandCommand()
	.check(({ token }) => {
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

isAnalyzeMode = options._[0] === 'analyze';
const excludes = /^log Debug: search visits|^info time|^info root_score|^info root_transpositionid|^info transpositionid/;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const ws = new WebSocket(options.url);

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
		token: options.token
	}));

	ws.isAlive = true;

	bufferedInput.forEach((input) => ws.send(input));

	bufferedInput.length = 0;

	if (isAnalyzeMode) {
		analyze();
	}
});

ws.on('message', function message(data) {
	data = data + '';

	if (!excludes.test(data)) {
		console.log(data);
	}

	if (isAnalyzeMode) {
		onAnalyzeData(data);
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


function analyze() {
	(async () => {
		const moveFile = await fs.readFile(options.move_file);
		const moves = (moveFile + '').split(/(?:1[wg])|(?:\s\d+[wbgs]\s)/).map((m) => m.trim()).filter((m) => m);

		ws.send('newgame');

		ws.send('setoption name fixed_time value 3');

		const [firstMove, secondMove, ...restMoves] = moves;

		const setupCommands = getSetupCommands(firstMove, secondMove);

		for (const command of setupCommands) {
			ws.send(command);
		}

		for (let move of restMoves) {
			ws.send(`makemove ${move}`);
		}

		ws.send('go');

		// Send an extra round of go to avoid latency delays.
		ws.send('go');
	})();
}

let lastVists = 0;
function onAnalyzeData(data) {
	if (data.startsWith('info visits')) {
		const visits = Number.parseInt(/^info visits (\d+)/.exec(data)[1], 10);

		if (visits < MAX_VISITS && lastVists < visits) {
			ws.send('go');
			lastVists = visits;
		} else if (!isAnalyzeComplete) {
			isAnalyzeComplete = true;
			// Allow other messages to complete
			setTimeout(() => {
				ws.close();
				console.log('Analysis Complete');
			}, 2000);
		}
	}
}

function getSetupCommands(firstMove, secondMove) {
	let moves = (' ' + firstMove + ' ' + secondMove).match(/\s+\w\w\d/g);

	// If it is the first move for gold or the first move for silver.
	if (moves.length === 32) {
		const positions = Array(64).fill(' ');

		for (const move of moves) {
			const [piece, col, row] = move.trim();
			const colIdx = col.charCodeAt(0) - 97;
			const rowIdx = Number.parseInt(row) - 1;
			const posIdx = (7 - rowIdx) * 8 + colIdx;

			positions[posIdx] = piece;
		}

		const command = `setposition g [${positions.join('')}]`;

		console.log('log Debug:', command);

		return [command];
	}

	return [
		`makemove ${firstMove}`,
		`makemove ${secondMove}`
	];
}



