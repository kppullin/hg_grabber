var https = require('https'),
	fs = require('fs');
	path = require('path'),
	url = require('url'),
	util = require('util'),
	childProcess = require('child_process');

// 3rd-party
var	cheerio = require('cheerio'),
	async = require('async'),
	program = require('commander');

program
	.version('0.0.2')
	.usage('[options] [DEST]')
	.option('-u, --user <USER>', 'Username')
	.option('-p, --pass <PASS>', 'Password')
	.option('-R, --repo-root <URL>', 'Repository Root URL')
	.option('-d, --dest [DEST]', 'Destination Path [./]')
	.option('-P, --parallelism <N>', 'Number of parallel clone/update threads [4]', 4)
	.parse(process.argv);

if (!program.user) {
	console.log('\n\t** user required **');
	program.help();	// exits program
}

if (!program.repoRoot) {
	console.log('\n\t** repo-root required **');
	program.help();
}

if (!program.dest) {
	console.log('\n\t** dest required **');
	program.help();
}

// local vars
var	repoRoot = program.repoRoot,
	username = program.user,
	password = program.pass,
	hgRoot = (program.dest || process.argv.splice(-1)[0]) || './',
	parallelThreads = program.parallelism,
	reposToIgnore = [''];

if (!program.pass) {
	program.password('password: ', function(pass) {
		password = pass;
		process.stdin.destroy();

		getListAndGrab();
	});
} else {
	getListAndGrab();
}

var grabRepos = function(repoList) {
	
	async.forEachLimit(repoList, parallelThreads, function(repoNode, callback) {

		var repo = $(repoNode).children('td > a').first();
		var href = repo.attr('href');
		var name = repo.text();

		if (reposToIgnore.indexOf(name) > -1) {
			console.log('Ignoring ' + name);
			callback();
		}

		var srcUrl = url.parse(repoRoot);
			srcUrl.auth = username + ':' + password;
			srcUrl.pathname = href;

		var repoPath = path.join(hgRoot, name);
		var exists = fs.existsSync(repoPath);

		if (!exists) {
			console.log('Cloning ' + name + ' to ' + repoPath + '...');

			var child = childProcess.execFile('hg', 
				[ '--config' ,'ui.interactive=1', 'clone', url.format(srcUrl), repoPath],
				{ maxBuffers: 1024 * 1024 * 5 }
			);

			// continue with serial execution.
			child.on('exit', function() { callback(); });
			
		} else {
			console.log('Pulling ' + name + '...');

			async.series([
				function(pullCompleted) {
					var child = childProcess.execFile('hg',
						['--config', 'ui.interactive=1', 'pull', '-R', repoPath, url.format(srcUrl), '--rebase'],
						{ maxBuffers: 1024 * 1024 * 5 },
						 function(error, stdout, stderr) {
						 	if (error != null && error.code != 0) {
						 		outputFailureMsg('pull', name, stdout, stderr);
						 	}
						 }
					);

					// continue with serial execution.
					child.on('exit', function(code) {
						var err = code != 0 ? code : null;
						pullCompleted(err);
					});
				},
				function(updateCompleted) {
					var child = childProcess.execFile('hg',
						['--config', 'ui.interactive=1', 'update', '-R', repoPath, '--check'],
						{ maxBuffers: 1024 * 1024 * 5 },
						function(error, stdout, stderr) {
							if (error != null && error.code != 0) {
						 		outputFailureMsg('update', name, stdout, stderr);
						 	}
						}
					);

					child.on('exit', function(code) { updateCompleted() });
				}],
				function () { callback(); }
			);
		}

	}, function(err) {
		if (err) {
			console.log('Error: ' + err);
		}
		process.exit(0);
	});
}

var outputFailureMsg = function(operation, repoName, stdoutBuf, stderrBuf) {
	var outStr = indentStr(stdoutBuf.toString().trim());
	var errStr = indentStr(stderrBuf.toString().trim());
	var msg = outStr.length > 0 ? outStr + '\n' + errStr : errStr;
						 	
	console.log(util.format('Failed to %s "%s". Error:\n%s', operation, repoName, msg));
}

var indentStr = function(text) {
	var lines = text.split(/\r?\n/);
	if (lines.length == 1 && lines[0].length == 0)
		return '';

	return lines
			.map(function(line) { return '\t' + line; })
			.join('\n');
}

// get hg homepage html
var getListAndGrab = function() {

	var auth = 'Basic ' + new Buffer(username + ':' + password).toString('base64'),
		headers = { Authorization: auth };

	console.log('Fetching list of files...');
	var req = https.request({ hostname: url.parse(repoRoot).hostname, headers: headers }, function(res) {
		res.setEncoding('utf8');

		var html = '';
		res.on('data', function(chunk) {
			html += chunk;
		})
		.on('end', function() {
			console.log('Fetch complete.');

			if (html.indexOf('Access is denied') > -1) {
				console.log('Authorization error :(');
				return;
			}

			$ = cheerio.load(html);
			var rows = $('.bigtable').children('tr.parity0, tr.parity1');

			grabRepos(rows);
		});
	}).end();
};