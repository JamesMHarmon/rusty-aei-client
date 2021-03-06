const yarg = require('yargs');
const readline = require('readline');
const WebSocket = require('ws');
const fs = require('fs/promises');
const { version } = require('./package.json');

const MAX_VISITS = 5000000;

let isAnalyzeMode = false;
let isAnalyzeComplete = false;

/* eslint-disable indent */
const { _: args, move_file, url, token } = yarg
	.usage('Usage: -t <token>')
	.version(version)
	.command('aei')
	.command('analyze <move_file>')
	.option('t', { alias: 'token', describe: 'Your token', type: 'string', demandOption: false })
	.option('u', { alias: 'url', describe: 'Rusty remote endpoint', default: 'ws://45.79.196.77:8080', type: 'string', demandOption: false })
	.demandCommand(1, 1, 'Specify either the "aei" or "analyze".', 'Only one command can be specified')
	.check(({ _, token, move_file }) => {
		const command = (_[0] || '').toLowerCase();

		const commandSpecified = ['aei', 'analyze'].find((c) => c === command);

		if (!commandSpecified) {
			throw new Error('The command "aei" or "analyze" must be specified.');
		}

		if (commandSpecified === 'analyze' && !move_file) {
			throw new Error('A <move_file> must be specified.');
		}

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

isAnalyzeMode = args[0] === 'analyze';
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
		const moveFile = (await fs.readFile(move_file)) + '';
		const moveFileWithoutPass = moveFile.replace('2w pass', '');
		const silverToMove = moveFileWithoutPass.length !== moveFile.length;
		const moves = moveFileWithoutPass.split(/(?:^|\s+)\d+[wbgs]\s+/).map((m) => m.trim()).filter((m) => m);

		ws.send('newgame');

		ws.send('setoption name fixed_time value 3');

		const [firstMove, secondMove, ...restMoves] = moves;

		const setupCommands = getSetupCommands(firstMove, secondMove, silverToMove);

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

function getSetupCommands(firstMove, secondMove, silverToMove) {
	let moves = (' ' + firstMove + ' ' + secondMove).match(/\s+\w\w\d/g);
	const pieceToMove = silverToMove ? 's' : 'g';

	const positions = Array(64).fill(' ');

	for (const move of moves) {
		const [piece, col, row] = move.trim();
		const colIdx = col.charCodeAt(0) - 97;
		const rowIdx = Number.parseInt(row) - 1;
		const posIdx = (7 - rowIdx) * 8 + colIdx;

		positions[posIdx] = piece;
	}

	const command = `setposition ${pieceToMove} [${positions.join('')}]`;

	console.log('log Debug:', command);

	return [command];
}



