const pollsTemplateJson = require('./testdata.json');

const tutorialAnswersData = require('./tutorialTemplates/tutorialAnswers.json');
const tutorialPollsData = require('./tutorialTemplates/tutorialPolls.json');
const tutorialQuestionsData = require('./tutorialTemplates/tutorialQuestions.json');
const modelFieldModelData = require('./models/modelFieldModel.json');
const answerModelFieldData = require('./models/answerModelFieldModel.json');
const { ACL } = require('parse');

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
    .first();
};

const getCustomParseObject = (className) => {
  return Parse.Object.fromJSON(
    {
      "__type": "Object",
      "className": className,
    });
}
const fillParseTable = async (dataArr, className, requiredAttr, mergeAttr) => {
  const result = [];
  for (const item of dataArr) {
    const parseObj = getCustomParseObject(className);
    parseObj.set(item);
    if (mergeAttr) parseObj.set(mergeAttr);
    if (requiredAttr) parseObj.set(requiredAttr);
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

  //adding answer model obj to models table
  let answerModelTableObj = buildModelTableObj("Answer", siteObj, user, `${tablesFirstPartName}_Answer_${tablesUniquePartName}`);
  await answerModelTableObj.save(null, { "useMasterKey": true });

  //adding answer obj fields to ModelField table
  const answerObjsModelField = await fillParseTable(answerModelFieldData, "ModelField", { model: answerModelTableObj.toPointer() }, {  ACL: new Parse.ACL(user) });
  
  //adding user's Answer table;
  const publicReadUserWriteACL = user.getACL();
  publicReadUserWriteACL.setPublicReadAccess(true);
  const tutorialAnswers = await fillParseTable(tutorialAnswersData["answersDataArray"], `${tablesFirstPartName}_Answer_${tablesUniquePartName}`, null, { "ACL": publicReadUserWriteACL });
  
  //adding question obj

  //adding poll obj

  //add ModelField data

  //TODO apply CPL to new table https://docs.parseplatform.org/js/guide/ "POST http://my-parse-server.com/schemas/Announcement"
  
  //fill questions data
  //fill polls data

  return getStatusResponseObj(200, "Finished registration");
});

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
