const fs = require('fs');
const path = require('path');

//This method is against global security rules as it can expose emails of users via brute force
Parse.Cloud.define("user-status", async (request) => {
  const { email } = request.params;
  if (!email) return getStatusResponseObj(400, 'Email is required');

  return await getUserEmailStatus(email);
});

//Currently parse server stores email as username, so no username exists
Parse.Cloud.define("user-register", async (request) => {
  const { email, password, username } = request.params;
  if (!email || !password || !username) return getStatusResponseObj(400, 'Email, password and username are required');
  if (await verifyObjectExists("User", "email", email)) return getStatusResponseObj(409, 'Email is already taken');
  if (await verifyObjectExists("User", "username", username)) return getStatusResponseObj(409, 'Username is already taken');

  await Parse.User.signUp(email, password, {'email': email});
  
  return getStatusResponseObj(200, "Registered");
});

Parse.Cloud.define("poll-end", async (request) => {
  const { boardId } = request.params;

  const authUser = await getSessionTokenUser(request);
  if (authUser.status != 200) return authUser;
  
  //TODO move query block to separate method down there
  const activeSessions = await (new Parse.Query(
    Parse.Object.extend("PollSession")))
    .equalTo("boardId", boardId)
    .equalTo("isActive", true)
    .find({ useMasterKey: true });

  if (!activeSessions.length) return getStatusResponseObj(404, "No active sessions found");

  for (const session of activeSessions) {
    session.set({ "isActive": false });
  }
  await Parse.Object.saveAll(activeSessions, { useMasterKey: true });

  return getStatusResponseObj(200, "Active sessions ended");
});

Parse.Cloud.define("poll-start", async (request) => {
  const { boardId, pollId } = request.params;
  
  if (!boardId || !pollId) return getStatusResponseObj(400, "No required param found");

  const authUser = await getSessionTokenUser(request);
  if (authUser.status != 200) return authUser;
  const user = authUser.payload;

  const activeSessions = await (new Parse.Query(
    Parse.Object.extend("PollSession")))
    .equalTo("boardId", boardId)
    .equalTo("isActive", true)
    .find({ useMasterKey: true });

  if (activeSessions.length) {
    return getStatusResponseObj(400, "Poll Session is already running for this board");
  }
  const userModels = await getPollModels(user);
  const polls = await getObjects("tableName", userModels, null, [{ key: "objectId", value: pollId }]);

  if (!polls.length) return getStatusResponseObj(404, "No pollId found");

  const newSession = new (Parse.Object.extend("PollSession"));
  newSession.set({ 
    boardId: boardId,
    facilitator: user.toPointer(),
    tableName: polls[0].className,
    pollId: polls[0].id,
  });

  await newSession.save(null, { useMasterKey: true });

  return getStatusResponseObj(200, "Poll started");

});

Parse.Cloud.define("poll", async (request) => {
  const { boardId } = request.params;
  if (!boardId) {
    return getStatusResponseObj(406, "Required parameters not provided.");
  }

  const session = await (new Parse.Query("PollSession"))
    .equalTo("isActive", true)
    .equalTo("boardId", boardId)
    .first({ useMasterKey: true });
  if (!session) {
    return getStatusResponseObj(400, "Wrong boardId");
  }
  const pollId = session.get("pollId");
  const tableName = session.get("tableName");

  const poll = getObjectQuery(
    tableName,
    getFullPollInclude(),
    [{ key: 'objectId', value: pollId}],
  )
  
  if (!poll) {
    return getStatusResponseObj(404, "No poll data found");
  }

  return poll;
});

//TODO map status responses and distribute it among codes
Parse.Cloud.define("polls", async (request) => {
  const authUser = await getSessionTokenUser(request);
  if (authUser.status != 200) return authUser;
  const user = authUser.payload;
  const userModels = await getPollModels(user);  
  let polls = await getObjects("tableName", userModels, getFullPollInclude(), [{ key: 't__status', value: 'Published' }]);
  polls = polls.concat(await getObjects("tableName", userModels, getFullPollInclude(), [{ key: 't__status', value: 'Updated' }]));
  
  return polls;
});

Parse.Cloud.define("user-finalize", async (request) => {

  //Here is a strange situation with caching. 
  //If required objects are updated, the updates are stored between sessions.
  //I am not aware of the mechanism behind this behaviour.
  //This ugly lines should be rafactored as soon as such behaviour is clarified.
  const tutorialPollsData = JSON.parse(JSON.stringify(require('./tutorialTemplates/tutorialPolls.json')));
  const pollModelFieldData = JSON.parse(JSON.stringify(require('./models/pollModelFieldModel.json')));
  
  const tutorialQuestionsData = JSON.parse(JSON.stringify(require('./tutorialTemplates/tutorialQuestions.json')));
  const questionModelFieldData = JSON.parse(JSON.stringify(require('./models/questionModelFieldModel.json')));
  
  const tutorialAnswersData = JSON.parse(JSON.stringify(require('./tutorialTemplates/tutorialAnswers.json')));
  const answerModelFieldData = JSON.parse(JSON.stringify(require('./models/answerModelFieldModel.json')));

  const questionsAnswersWiring = JSON.parse(JSON.stringify(require('./tutorialTemplates/wiringQuestionsAnswers.json')));
  const pollsQuestionsWiring = JSON.parse(JSON.stringify(require('./tutorialTemplates/wiringPollsQuestions.json')));

  const { email } = request.params;
  if ((await getUserEmailStatus(email)).status != 200) return getStatusResponseObj(400, "Email missing or was not confirmed");
  //TODO uncomment for testing
  //await Parse.User.signUp(email, password, {'email': email});
  
  const user = await findObject("User", "email", email);
  
  //TODO uncomment for testing
  //user.set({"emailVerified": true});
  //await user.save(null, { "useMasterKey": true });

  //generate sections for tables naming: email before @ sign and base64 of whole email
  const tablesFirstPartName = email.split("@")[0].replace(/\.+/g,'');
  const tablesUniquePartName = Buffer.from(email, 'binary').toString('base64').replace(/(=+)/g,"");

  //add new site data with name and owner pointer
  let siteObj = await buildSiteTableObj(tablesUniquePartName, "MyPolls", user)
  await siteObj.save(null, { "useMasterKey": true });

  //TODO refactor this monstrous method calls
  const filledAnswerTutorial = await fillClassTables("Answer", siteObj, user, `${tablesFirstPartName}_Answer_${tablesUniquePartName}`, tutorialAnswersData, answerModelFieldData);
  
  const filledQuestionTutorial = await fillClassTables("Question", siteObj, user, `${tablesFirstPartName}_Question_${tablesUniquePartName}`, tutorialQuestionsData, questionModelFieldData);
  wireParseObjects(filledQuestionTutorial, filledAnswerTutorial, questionsAnswersWiring, "answers");
  await Parse.Object.saveAll(filledQuestionTutorial, { useMasterKey: true });
  
  const filledPollTutorial = await fillClassTables("Poll", siteObj, user, `${tablesFirstPartName}_Poll_${tablesUniquePartName}`, tutorialPollsData, pollModelFieldData);
  wireParseObjects(filledPollTutorial, filledQuestionTutorial, pollsQuestionsWiring, "questions");
  await Parse.Object.saveAll(filledPollTutorial, { useMasterKey: true });

  return getStatusResponseObj(200, "Finished registration");
});

const getFullPollInclude = () => {
  return [
    'introBackgroundImage',
    'outroBackgroundImage',
    'questionsBackgroundImage',
    'questions',
    'questions.image',
    'questions.answers',
    'questions.answers.image',
  ];
};

const getStatusResponseObj = (statusCode, statusMessage, payload) => {
  return { 
    status: statusCode,
    message: statusMessage,
    payload: payload,
  };
};

const verifyObjectExists = async (className, columnName, fieldValue) => {
  return await (new Parse.Query(
    Parse.Object.extend(className)))
    .equalTo(columnName, fieldValue)
    .first({ useMasterKey: true });
};

const getCustomParseObject = (className) => {
  return Parse.Object.fromJSON(
    {
      "__type": "Object",
      "className": className,
    });
}

const massFillParseTable = async (dataArr, className, mergeAttr) => {
  const result = [];
  for (const item of dataArr) {
    const parseObj = getCustomParseObject(className);
    parseObj.set(item);
    if (mergeAttr) parseObj.set(mergeAttr);
    result.push(parseObj);
  }
  await Parse.Object.saveAll(result);

  return result;
}

const findObject = async (className, searchColumn, value) => {
  return await (new Parse.Query(
    Parse.Object.extend(className)))
    .equalTo(searchColumn, value)
    .first();
}

//TODO select between await and then
const getUserEmailStatus = async (email) => {
  return await (new Parse.Query(
    Parse.Object.extend("User")))
    .equalTo("email", email)
    .first({ useMasterKey: true})
    .then( result => {
      if (!result) return getStatusResponseObj(404, 'Email is not found');
      if (!result.get('emailVerified')) return getStatusResponseObj(403, 'Email is not verified');

      return getStatusResponseObj(200, 'Registered');
    });
}

//TODO uncomment on tests done
const getSessionTokenUser = async (request) => {

  const sessionToken = request.headers['x-parse-session-token'];
  console.log(JSON.stringify(request));
  console.log(sessionToken);
  if (!sessionToken)
    return getStatusResponseObj(403, "User header required");

  let user;
  try {
    user = await Parse.User.me(sessionToken);
  } catch (e) {
    return getStatusResponseObj(403, "Session token is not valid");
  }

  return getStatusResponseObj(200, "User fetched", user);
}

const getPollModels = async (user) => {
  const userSites = await (new Parse.Query(
    Parse.Object.extend("Site")))
    .equalTo("owner", user)
    .find({ useMasterKey: true });
  return await (new Parse.Query(
    Parse.Object.extend("Model")))
    .containedIn("site", userSites)
    .equalTo("nameId", "Poll")
    .find({ useMasterKey: true });
};

//TODO redo calls to it to getAll with published state sent by equal param
const getObjects = async (tableNameField, dataArr, includeStrings, equalPairs) => {
  const result = [];
  for (const item of dataArr) {
    const tableName = item.get(tableNameField);
    obj = await getObjectQuery(tableName, includeStrings, equalPairs);
    result.push(obj);
  }

  return result.flat();
};

const getObjectQuery = async (tableName, includeStrings, equalPairs) => {
  const pollDataQuery = new Parse.Query(tableName);    
  if (includeStrings) {
    for (const item of includeStrings) {
      pollDataQuery.include(item);
    }
  }
  if (equalPairs) {
    for (const pair of equalPairs) {
      pollDataQuery.equalTo(pair.key, pair.value);
    }
  }
  return await pollDataQuery.find({ useMasterKey: true });
}

const fillClassTables = async (type, siteObj, user, tableName, tutorialDataArr, modelFieldDataArr) => {
  //adding model obj to models table
  let modelTableObj = buildModelTableObj(type, siteObj, user, tableName);
  await modelTableObj.save(null, { "useMasterKey": true });
  //adding obj fields to ModelField table
  const objsModelField = await massFillParseTable(modelFieldDataArr, "ModelField", { model: modelTableObj.toPointer(), ACL: new Parse.ACL(user) });
  //writing pictures to polls
  await fillMediaUrls(tutorialDataArr, getPublicReadACL(user), siteObj);
  //adding user's tutorial answers table
  const tutorial = await massFillParseTable(tutorialDataArr, tableName, { "ACL": getPublicReadACL(user), "t__status": "Published" });

  //updating class level permissions with read *, write user permissions
  const scheme = new Parse.Schema(tableName);
  await scheme.get({ useMasterKey: true });
  scheme.setCLP(getCLP(user.id));
  await scheme.update({ useMasterKey: true});

  return tutorial;
}

const getPublicReadACL = (user) => {
  const acl = user.getACL();
  acl.setPublicReadAccess(true);

  return acl;
}

const fillMediaUrls = async (dataArr, acl, site) => {
  //double "for" construction is oldschool, must be more efficient way
  for (const item of dataArr) {
    let deleteImageNameFields = [];
    for (const [key, value] of Object.entries(item)) {
      if (key && value && key.toLowerCase().includes("image") && value.includes(".png")) {
        item[key] = await saveMediaItem(value, `${key}Name.png`, acl, site);
        deleteImageNameFields.push(`${key}Name`);
      }
    }
    deleteImageNameFields.forEach(element => delete item[element]);
  };
}

const saveMediaItem = async (filePath, fileName, acl, site) => {
  //reading file method is complicated, must be easier solution
  const data = fs.readFileSync(path.join(__dirname, filePath));
  var base64 = data.toString("base64");
  var file = new Parse.File(fileName, { base64: base64 });
  await file.save();

  const MediaItem = Parse.Object.extend("MediaItem");
  const mediaItem = new MediaItem();

  mediaItem.set({ 
    site: site.toPointer(),
    ACL: acl,
    name: "cat",
    type: "image/png",
    file: file,
    size: data.length, 
    assigned: false,
  });
  await mediaItem.save();

  return mediaItem;
};

const buildSiteTableObj = (tableName, title, user) => {
  const siteObj = new (Parse.Object.extend("Site"));
  siteObj.set({
    nameId: tableName,
    ACL: new Parse.ACL(user),
    name: title,
    owner: user,
  });

  return siteObj;
}

const buildModelTableObj = (className, siteObj, user, tableName) => {
  const modelObj = new (Parse.Object.extend("Model"));
  modelObj.set({
    color: "rgba(128, 128, 128, 1)",
    nameId: className,
    site: siteObj.toPointer(),
    ACL: new Parse.ACL(user),
    name: className,
    tableName: tableName,
  });

  return modelObj;
}

const wireParseObjects = (dataArrParent, dataArrChild, wiringTable, columnName) => {
  for (i = 0; i < dataArrParent.length; i++) {
    const filteredArr = dataArrChild.filter( (value, index, arr) => wiringTable[i].includes(index) );
    dataArrParent[i].set({ [columnName]: filteredArr });
  }

  return dataArrParent;
}

const getCLP = (userId) => {
  return {
      find: {
          "*": true,
          [userId]: true
      },
      count: {
          "*": true,
          [userId]: true
      },
      get: {
          "*": true,
          [userId]: true
      },
      create: {
          [userId]: true
      },
      update: {
          [userId]: true
      },
      delete: {
          [userId]: true
      },
      addField: {
          [userId]: true
      },
      protectedFields: {
          "*": []
      }
    }
}
