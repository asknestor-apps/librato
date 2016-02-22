var parseTimePeriod = function(time) {
  var amount, matchData;
  matchData = /(\d+)?\s*(second|minute|hour|day|week)s?/.exec(time);
  if (!matchData[2]) {
    return;
  }
  amount = matchData[1] ? parseInt(matchData, 10) : 1;
  return amount * (function() {
    switch (matchData[2]) {
      case 'second':
        return 1;
      case 'minute':
        return 60;
      case 'hour':
        return 60 * 60;
      case 'day':
        return 60 * 60 * 24;
      case 'week':
        return 60 * 60 * 24 * 7;
    }
  })();
};

var getSnapshot = function(url, msg, robot, done) {
  var user = process.env.NESTOR_LIBRATO_USER;
  var pass = process.env.NESTOR_LIBRATO_TOKEN;
  var auth = 'Basic ' + new Buffer(user + ':' + pass).toString('base64');

  robot.http(url).headers({
    Authorization: auth,
    Accept: 'application/json'
  }).get()(function(err, res, body) {
    var json;
    if (res.statusCode == 200) {
      json = JSON.parse(body);
      if (json['image_href']) {
        msg.reply(json['image_href'], done);
      } else {
        setTimeout((function() {
          getSnapshot(url, msg, robot, done);
        }), 100);
      }
    } else if (res.statusCode == 204 || res.statusCode == 202) {
      setTimeout((function() {
        getSnapshot(url, msg, robot, done);
      }), 100);
    } else {
      msg.reply("Unable to get snap shot from librato :(\nStatus Code: " + res.statusCode + "\nBody:\n\n" + body, done);
    }
  });
};

var createSnapshot = function(inst, source, time, msg, robot, done) {
  var auth, data, pass, url, user;
  url = "https://metrics-api.librato.com/v1/snapshots";
  data = JSON.stringify({
    subject: {
      instrument: {
        href: "https://metrics-api.librato.com/v1/instruments/" + inst.id,
        sources: [source]
      }
    },
    duration: time
  });

  user = process.env.NESTOR_LIBRATO_USER;
  pass = process.env.NESTOR_LIBRATO_TOKEN;
  auth = 'Basic ' + new Buffer(user + ':' + pass).toString('base64');

  robot.http(url).headers({
    Authorization: auth,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }).post(data)(function(err, res, body) {
    var json;
    if (res.statusCode == 201) {
      json = JSON.parse(body);
      msg.reply(json['image_href'], done);
    } else if(res.statusCode == 202) {
      json = JSON.parse(body);
      getSnapshot(json['href'], msg, robot, done);
    } else {
      msg.reply("Unable to create snap shot from librato :(\nStatus Code: " + res.statusCode + "\nBody:\n\n" + body, done);
    }
  });
};

var getGraphForInstrument = function(inst, source, msg, timePeriod, robot, done) {
  var timePeriodInSeconds;
  timePeriodInSeconds = parseTimePeriod(timePeriod);
  if (!timePeriodInSeconds) {
    msg.reply("Sorry, I couldn't understand the time peroid " + timePeriod + ".\nTry something like '[<number> ]<second|minute|hour|day|week>s'", done);
  }
  createSnapshot(inst, source, timePeriodInSeconds, msg, robot, done);
};

var processInstrumentResponse = function(body, source, msg, timePeriod, robot, done) {
  var found, json, names;
  json = JSON.parse(body);
  found = json['query']['found'];
  if (found === 0) {
    msg.reply("Sorry, couldn't find that graph!", done);
  } else if (found > 1) {
    names = json['instruments'].reduce(function(acc, inst) {
      return acc + "\n" + inst.name;
    });
    msg.reply("I found " + found + " graphs named something like that. Which one did you mean?\n\n" + names, done);
  } else {
    getGraphForInstrument(json['instruments'][0], source, msg, timePeriod, robot, done);
  }
};

module.exports = function(robot) {
  robot.respond(/graph me$/, function(msg, done) {
    var user = process.env.NESTOR_LIBRATO_USER;
    var pass = process.env.NESTOR_LIBRATO_TOKEN;
    var auth = 'Basic ' + new Buffer(user + ':' + pass).toString('base64');

    robot.http("https://metrics-api.librato.com/v1/instruments").headers({
      Authorization: auth,
      Accept: 'application/json'
    }).get()(function(err, res, body) {
      if(res.statusCode == 200) {
        var names = [];
        json = JSON.parse(body);

        msg.reply("Here are the list of instruments").then(function() {
          names = json['instruments'].map(function(inst) {
            return "* " + inst.name;
          });
          msg.send(names, done);
        });
      } else {
        msg.reply("Couldn't find any instruments on Librato", done);
      }
    });
  });

  robot.respond(/graph me ([\w\.:\- ]+?)\s*(?:over the (?:last|past)? )?(\d+ (?:second|minute|hour|day|week)s?)?(?: source (.+))?$/i, function(msg, done) {
    var instrument = msg.match[1];
    var timePeriod = msg.match[2] || 'hour';
    var source = msg.match[3] || '*';
    var user = process.env.NESTOR_LIBRATO_USER;
    var pass = process.env.NESTOR_LIBRATO_TOKEN;
    var auth = 'Basic ' + new Buffer(user + ':' + pass).toString('base64');

    robot.http("https://metrics-api.librato.com/v1/instruments?name=" + (escape(instrument))).headers({
      Authorization: auth,
      Accept: 'application/json'
    }).get()(function(err, res, body) {
      if(res.statusCode == 200) {
        processInstrumentResponse(body, source, msg, timePeriod, robot, done);
      } else {
        msg.reply("Unable to get list of instruments from librato :(\nStatus Code: " + res.statusCode + "\nBody:\n\n" + body, done);
      }
    });
  });
};
