const fs = require("fs-extra");
const axios = require("axios");

module.exports = {
config: {
name: "postfb",
version: "2.1",
author: "",
countDown: 5,
role: 2,
shortDescription: {
en: "Create a Facebook post"
},
longDescription: {
en: "Publish a Facebook post with text and multiple images"
},
category: "Social",
guide: {
en: "{pn}"
}
},

onStart: async function ({ event, api, commandHandler }) {
const { threadID, messageID, senderID } = event;
const uuid = getGUID();

const formData = {
input: {
composer_entry_point: "inline_composer",
composer_source_surface: "timeline",
idempotence_token: uuid + "_FEED",
source: "WWW",
attachments: [],
audience: {
privacy: {
allow: [],
base_state: "FRIENDS",
deny: [],
tag_expansion_state: "UNSPECIFIED"
}
},
message: {
ranges: [],
text: ""
},
with_tags_ids: [],
inline_activities: [],
explicit_place_id: "0",
text_format_preset_id: "0",
logging: {
composer_session_id: uuid
},
tracking: [null],
actor_id: api.getCurrentUserID(),
client_mutation_id: Math.floor(Math.random() * 17)
}
};

api.sendMessage(
"Select who can see this post:\n1. Public\n2. Friends\n3. Only me",
threadID,
(e, info) => {
commandHandler.setReplyHandler(info.messageID, senderID, {
commandName: this.config.name,
data: formData,
type: "audience"
});
},
messageID
);
},

handleReply: async function ({ event, api, data, type, commandHandler }) {
const { threadID, messageID, attachments, body, senderID } = event;
const botID = api.getCurrentUserID();
const formData = data;

const cacheDir = `${__dirname}/cache`;
fs.ensureDirSync(cacheDir);

async function uploadAttachments(files) {
const tasks = files.map(file =>
api.httpPostFormData(
`https://www.facebook.com/profile/picture/upload/?profile_id=${botID}&photo_source=57&av=${botID}`,
{ file }
)
);
return Promise.all(tasks);
}

if (type === "audience") {
if (!["1", "2", "3"].includes(body))
return api.sendMessage("Invalid selection. Choose 1, 2, or 3.", threadID, messageID);

formData.input.audience.privacy.base_state =
body === "1" ? "EVERYONE" : body === "2" ? "FRIENDS" : "SELF";

api.unsendMessage(event.messageReply.messageID, () => {
api.sendMessage(
"Send the post text now. Reply with 0 to skip.",
threadID,
(e, info) => {
commandHandler.setReplyHandler(info.messageID, senderID, {
commandName: this.config.name,
data: formData,
type: "text"
});
},
messageID
);
});
} else if (type === "text") {
if (body !== "0") formData.input.message.text = body;

api.unsendMessage(event.messageReply.messageID, () => {
api.sendMessage(
"Send images now. Reply with 0 to post without images.",
threadID,
(e, info) => {
commandHandler.setReplyHandler(info.messageID, senderID, {
commandName: this.config.name,
data: formData,
type: "media"
});
},
messageID
);
});
} else if (type === "media") {
if (body !== "0" && attachments.length) {
const streams = [];

for (const att of attachments) {
if (att.type !== "photo") continue;

const filePath = `${cacheDir}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
const res = await axios.get(att.url, { responseType: "stream" });

await new Promise((resolve, reject) => {
const w = fs.createWriteStream(filePath);
res.data.pipe(w);
w.on("finish", resolve);
w.on("error", reject);
});

streams.push(fs.createReadStream(filePath));
}

const uploaded = await uploadAttachments(streams);

for (let r of uploaded) {
if (typeof r === "string") r = JSON.parse(r.replace("for (;;);", ""));
if (r?.payload?.fbid) {
formData.input.attachments.push({
photo: { id: r.payload.fbid.toString() }
});
}
}
}

const form = {
av: botID,
fb_api_req_friendly_name: "ComposerStoryCreateMutation",
fb_api_caller_class: "RelayModern",
doc_id: "7711610262190099",
variables: JSON.stringify(formData)
};

api.httpPost("https://www.facebook.com/api/graphql/", form, (e, info) => {
api.unsendMessage(event.messageReply.messageID);

try {
if (e) throw e;
if (typeof info === "string")
info = JSON.parse(info.replace("for (;;);", ""));

const url = info?.data?.story_create?.story?.url;
if (!url) throw new Error("Post URL not found");

fs.emptyDirSync(cacheDir);

return api.sendMessage(url, threadID, messageID);
} catch {
return api.sendMessage(
"Post could not be created. Try again later.",
threadID,
messageID
);
}
});
}
}
};

function getGUID() {
let t = Date.now();
return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
const r = (t + Math.random() * 16) % 16 | 0;
t = Math.floor(t / 16);
return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
});
}