const fs = require('fs');
const path = require('path');

const getStatusResponseObj = (statusCode, statusMessage) => {
  return { 
    'status': statusCode, 
    'message': statusMessage, 
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
const fillParseTable = async (dataArr, className, mergeAttr) => {
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
    .first()
    .then( result => {
      if (!result) return getStatusResponseObj(404, 'Email is not found');
      if (!result.get('emailVerified')) return getStatusResponseObj(403, 'Email is not verified');

      return getStatusResponseObj(200, 'Registered');
    });
}

//This method is against global security rules as it can expose emails of users via brute force
Parse.Cloud.define("getUserStatus", async (request) => {
  const { email } = request.params;
  if (!email) return getStatusResponseObj(400, 'Email is required');

  return await getUserEmailStatus(email);
});

//Currently parse server stores email as username, so no username exists
Parse.Cloud.define("registerUser", async (request) => {
  const { email, password, username } = request.params;
  if (!email || !password || !username) return getStatusResponseObj(400, 'Email, password and username are required');
  if (await verifyObjectExists("User", "email", email)) return getStatusResponseObj(409, 'Email is already taken');
  if (await verifyObjectExists("User", "username", username)) return getStatusResponseObj(409, 'Username is already taken');

  //TODO close User table access
  await Parse.User.signUp(email, password, {'email': email});
  
  return getStatusResponseObj(200, "Registered");
});

Parse.Cloud.define("finishCreation", async (request) => {

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

  const { email, password } = request.params;
  //TODO - return this line when not testing
  //if ((await getUserEmailStatus(email)).status != 200) return getStatusResponseObj(400, "Email missing or was not confirmed");
  //TODO remove after test
  await Parse.User.signUp(email, password, {'email': email});
  
  const user = await findObject("User", "email", email);
  
  //TODO remove after test
  user.set({"emailVerified": true});
  await user.save(null, { "useMasterKey": true });

  //generate sections for tables naming: email before @ sign and base64 of whole email
  const tablesFirstPartName = email.split("@")[0].replace(/\.+/g,'');
  const tablesUniquePartName = Buffer.from(email, 'binary').toString('base64').replace(/(=+)/g,"");

  //add new site data with name and owner pointer
  let siteObj = await buildSiteTableObj(tablesUniquePartName, "MyPolls", user)
  await siteObj.save(null, { "useMasterKey": true });

  //add poll and then question with id of poll, etc.
  //TODO refactor this tree monstrous method calls
  const filledAnswerTutorial = await fillClassTables("Answer", siteObj, user, tablesFirstPartName, tablesUniquePartName, tutorialAnswersData, answerModelFieldData);
  const filledQuestionTutorial = await fillClassTables("Question", siteObj, user, tablesFirstPartName, tablesUniquePartName, tutorialQuestionsData, questionModelFieldData);
  const filledPollTutorial = await fillClassTables("Poll", siteObj, user, tablesFirstPartName, tablesUniquePartName, tutorialPollsData, pollModelFieldData);

  //TODO apply CPL to new table https://docs.parseplatform.org/js/guide/ "POST http://my-parse-server.com/schemas/Announcement"
  return getStatusResponseObj(200, "Finished registration");
});

const fillClassTables = async (type, siteObj, user, tablesFirstPartName, tablesUniquePartName, tutorialDataArr, modelFieldDataArr) => {
  //adding model obj to models table
  let modelTableObj = buildModelTableObj(type, siteObj, user, `${tablesFirstPartName}_${type}_${tablesUniquePartName}`);
  await modelTableObj.save(null, { "useMasterKey": true });
  //adding obj fields to ModelField table
  const objsModelField = await fillParseTable(modelFieldDataArr, "ModelField", { model: modelTableObj.toPointer(), ACL: new Parse.ACL(user) });
  //writing pictures to polls
  await fillMediaUrls(tutorialDataArr, getPublicReadACL(user), siteObj);
  //adding user's tutorial answers table
  const tutorial = await fillParseTable(tutorialDataArr, `${tablesFirstPartName}_${type}_${tablesUniquePartName}`, { "ACL": getPublicReadACL(user), "t__status": "Published" });
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
        item[key] = await saveMediaItem(value, `${key}Name`, acl, site);
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
