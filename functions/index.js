const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { CloudTasksClient } = require('@google-cloud/tasks')
admin.initializeApp();

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//

exports.addChatMessage = functions.firestore
  .document('/chats/{chatId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const chatId = context.params.chatId;
    const messageData = snapshot.data();
    const chatRef = admin
      .firestore()
      .collection('chats')
      .doc(chatId);
    const chatDoc = await chatRef.get();
    const chatData = chatDoc.data();
    if (chatDoc.exists) {
      const readStatus = chatData.readStatus;
      for (let userId in readStatus) {
        if (
          readStatus.hasOwnProperty(userId) &&
          userId !== messageData.senderId
        ) {
          readStatus[userId] = false;
        }
      }
      chatRef.update({
        recentMessage: messageData.text,
        recentSender: messageData.senderId,
        recentTimestamp: messageData.timestamp,
        readStatus: readStatus
      });

      // Notifications only if it's not a delayed message
      if(!messageData.delayed) {
        const memberInfo = chatData.memberInfo;
        const senderId = messageData.senderId;
        let body = memberInfo[senderId].name;
        if (messageData.text !== null) {
          body += `: ${messageData.text}`;
        } else {
          body += ' sent an image';
        }
  
        const payload = {
          notification: {
            title: chatData['name'],
            body: body
          }
        };
        const options = {
          priority: 'high',
          timeToLive: 60 * 60 * 24
        };
  
        for (const userId in memberInfo) {
          if (userId !== senderId) {
            const token = memberInfo[userId].token;
            if (token !== '') {
              admin.messaging().sendToDevice(token, payload, options);
            }
          }
        }
      } 
      // Notification delayed with Cloud Tasks
      else {
        let notificateInSeconds = messageData.timestamp.seconds;

        const project = 'nene-nene-4';
        const location = 'us-central1';
        const queue = 'future-push';

        const tasksClient = new CloudTasksClient();
        const queuePath = tasksClient.queuePath(project, location, queue);

        const url = `https://${location}-${project}.cloudfunctions.net/futurePushCallback`;
        const payload = { chatData, messageData }

        // Creates the task
        const task = {
          httpRequest: {
            httpMethod: 'POST',
            url,
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            headers: {
              'Content-Type': 'application/json',
            },
          },
          scheduleTime: {
            seconds: notificateInSeconds
          }
        }

        // Enqueue it
        await tasksClient.createTask({ parent: queuePath, task })
      }
    }
  }
);

exports.futurePushCallback =
functions.https.onRequest(async (req, res) => {
    const payload = req.body
    try {
      // Sends delayed notification
        const chatData = payload.chatData
        const messageData = payload.messageData
        const memberInfo = chatData.memberInfo;
        const senderId = messageData.senderId;
        body += 'A delayed message from ' + memberInfo[senderId].name + ' arrived to you!';
  
        const payload = {
          notification: {
            title: chatData['name'],
            body: body
          }
        };
        const options = {
          priority: 'high',
          timeToLive: 60 * 60 * 24
        };
  
        for (const userId in memberInfo) {
          if (userId !== senderId) {
            const token = memberInfo[userId].token;
            if (token !== '') {
              admin.messaging().sendToDevice(token, payload, options);
            }
          }
        }
        res.send(200)
    }
    catch (error) {
        console.error(error)
        res.status(500).send(error)
    }
})

exports.onUpdateUser = functions.firestore
  .document('/users/{userId}')
  .onUpdate(async (snapshot, context) => {
    const userId = context.params.userId;
    const userData = snapshot.after.data();
    const newToken = userData.token;

    // Loop through every chat user is in and update their token
    return admin
      .firestore()
      .collection('chats')
      .where('memberIds', 'array-contains', userId)
      .orderBy('recentTimestamp', 'desc')
      .get()
      .then(snapshots => {
        return snapshots.forEach(chatDoc => {
          const chatData = chatDoc.data();
          const memberInfo = chatData.memberInfo;
          memberInfo[userId].token = newToken;
          chatDoc.ref.update({ memberInfo: memberInfo });
        });
      });
  });
