const pollsTemplateJson = require('./testdata.json');

const tutorialAnswers = require('./tutorialTemplates/tutorialAnswers.json');
const tutorialPolls = require('./tutorialTemplates/tutorialPolls.json');
const tutorialQuestions = require('./tutorialTemplates/tutorialQuestions.json');
const modelFieldModel = require('./models/modelFieldModel.json');
const answerModelField = require('./models/answerModelFieldModel.json');

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

const fillParseTable = async (dataArr, className) => {
  let result = [];
  dataArr.forEach(function(item) {
    let parseObj = getCustomParseObject(className);
    //We implement double save as fromJson is broken on full object json parsing
    parseObj.save();
    parseObj.save(item);
    result.push(parseObj);
  });
  return result;
}

const updateObject = (dataArr, fieldName, fieldValue) => {
  dataArr.forEach(element => element[fieldName] = fieldValue);

  return dataArr;
}

//This method is against global security rules as it can expose emails of users via brute force
Parse.Cloud.define("getUserStatus", async (request) => {
  const {email} = request.params;
  if (!email) return getStatusResponseObj(400, 'Email is required');

  return await (new Parse.Query(
    Parse.Object.extend("User")))
    .equalTo("email", email)
    .first()
    .then( result => {
      if (!result) return getStatusResponseObj(404, 'Email is not found');
      if (!result.get('emailVerified')) return getStatusResponseObj(403, 'Email is not verified');

      return getStatusResponseObj(200, 'Registered');
    });
});

//Currently parse server stores email as username, so no username in fact exists
Parse.Cloud.define("registerUser", async (request) => {
  const {email, password, username } = request.params;
  if (!email || !password || !username) return getStatusResponseObj(400, 'Email, password and username are required');
  if (await verifyObjectExists("User", "email", email)) return getStatusResponseObj(409, 'Email is already taken');
  if (await verifyObjectExists("User", "username", username)) return getStatusResponseObj(409, 'Username is already taken');

  const user = await Parse.User.signUp(username, password, {'email': email});

  //generate sections for tables naming
  const tablesFirstPartName = email.split("@")[0].replace('.','');
  const tablesUniquePartName = Buffer.from(email, 'binary').toString('base64');

  //add new site data with name and owner pointer
  const siteObj = buildSiteTableObj("Site", "MyPolls", user);
  siteObj.save();
  //add model models
  //adding answer obj to models table
  const modelAnswerObj = buildModelTableObj("Answer", siteObj, user, `${tablesFirstPartName}_Answer_${tablesUniquePartName}`);
  modelAnswerObj.save();
  //adding answer obj fields to ModelField table


  //adding question obj

  //adding poll obj

  //add ModelField data


  //fill answers data
  const savedAnswers = await fillParseTable(tutorialAnswers["answersDataArray"], `${tablesFirstPartName}_Answer_${tablesUniquePartName}`);
  //apply CPL to new table https://docs.parseplatform.org/js/guide/ "POST http://my-parse-server.com/schemas/Announcement"
  
  //fill questions data
  //fill polls data

  return getStatusResponseObj(200, "Registered");
});

const buildSiteTableObj = (tableName, title, user) => {
  const siteObj = new (Parse.Object.extend("Site"));
  siteObj.set({
    nameId: tableName,
    ACL: user.ACL,
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
    site: siteObj,
    ACL: user.ACL,
    name: className,
    tableName: tableName,
  });

  return modelObj;
}
//Building answer ModelField 
const fillModelFieldTableObj = (className, value) => {
  const modelFieldObj = getCustomParseObject(className);  
  modelFieldObj.set(value);  
}

const buildModelFieldTableObj = (appearance, tableColumnName, isList, isRequired, modelObj, ACL, title, order, validations, type, isUnique) => {
  const modelFieldObj = new (Parse.Object.extend("ModelField"));
  modelFieldObj.set(modelFieldModel);
  modelFieldObj.set({
    color: "rgba(128, 128, 128, 1)",
    appearance: appearance,
    nameId: tableColumnName,
    isDisabled: false,
    isList: isList,
    isRequired: isRequired,
    model: modelObj,
    ACL: ACL,
    name: title,
    order: order,
    isTitle: false,
    validations: validations,
    type: type,
    isUnique: isUnique,
    validValues: validValues,
  });

  return modelFieldObj;
}

Parse.Cloud.define("testSchema", async (request) => {
  //this user variable will be filled with new registered user data
  const {email, password} = request.params;
  let user = await Parse.User.logIn(email, password);

  //filling Polls table
  let pollsClass = Parse.Object.fromJSON(pollsTemplateJson["pollclass"]);
  //due to not working import from json, I have to fill it and save twice with different data format
  await pollsClass.save();
  await pollsClass.save(pollsTemplateJson["pollTutorialValues"]);




  return obj;

  const GameScoreJs = Parse.Object.extend("GameScoreJs");
  const gameScoreJs = new GameScoreJs();
  gameScoreJs.set(pollsTemplateJson);
  console.log('---------------');
  console.log(gameScoreJs);
  console.log('---------------');
  await gameScoreJs.save();
  console.log('---------------');
  console.log(gameScoreJs);
  console.log('---------------');
  console.log('---------------');
  console.log(pollsTemplateJson);
  console.log('---------------');
  //let obj = Parse.Object.fromJSON(pollsTemplateJson);
  console.log('---------------');
  console.log(obj);
  console.log('---------------');

  await obj.save();
  await obj.save({"value": 10});
  
  // const schema = new Parse.Schema('MyClass');
  // schema.addString('field');
  // schema.save();

  return obj;
  
  // const GameScore = Parse.Object.extend("GameScore");
  // const query = new Parse.Query(GameScore);
  // const gameScore = await query.get("2ayV37JLkX");
  // const GameScoreAdddd = gameScore.extend("GameScoreAdddd");
  // const gameScoreAdddd = new GameScoreAdddd();
  // gameScoreAdddd.set('valueAddeddd', 10);
  // await gameScoreAdddd.save();
  // return gameScoreAdddd;
/*
  const GameScore = Parse.Object.extend("GameScore");
  const gameScore = new GameScore();
  gameScore.set('value', 10);
  await gameScore.save();

  const GameScoreAdd = GameScore.extend("GameScoreAdd");
  const gameScoreAdd = new GameScoreAdd();
  gameScoreAdd.set('valueAdded', 10);
  await gameScoreAdd.save();

  return gameScoreAdd;*/
});