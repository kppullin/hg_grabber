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
	.option('-u, --username <USER>', 'Username')
	.option('-p, --password <PASS>', 'Password')
	.option('-R, --repo-root <URL>', 'Repository Root URL')
	.option('-d, --dest [DEST]', 'Destination Path [./]')
	.option('-P, --parallelism <N>', 'Number of parallel clone/update threads [4]', 4)
	.parse(process.argv);

// local vars
var	repoRoot =  program.repoRoot,
	username = program.username,
	password = program.password,
	hgRoot = (program.dest || process.argv.splice(-1)[0]) || './',
	parallelThreads = program.parallelism,
	reposToIgnore = [''];

	auth = 'Basic ' + new Buffer(username + ':' + password).toString('base64'),
	headers = { Authorization: auth };

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

			var child = childProcess.execFile('hg',
				['--config', 'ui.interactive=1', 'pull', '-R', repoPath, url.format(srcUrl)],
				{ maxBuffers: 1024 * 1024 * 5 }
			);

			// continue with serial execution.
			child.on('exit', function() { callback(); });
		}

	}, function(err) {
		if (err) {
			console.log(err);
		}
		process.exit(0);
	});
}


// get hg homepage html
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
		var rows = $('.bigtable').children('tr.parity0, tr.parity1').toArray();

		grabRepos(rows);
	});
}).end();