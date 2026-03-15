"use strict";

const urlModule = require("url");
const stream = require("stream");
const bluebird = require("bluebird");
const querystring = require("querystring");
const crypto = require("crypto");

const NetworkClient = (() => {
    const buildRequestDefaults = (proxy) => {
        const defaults = { jar: true, family: 4, agentOptions: { family: 4 } };
        if (proxy) defaults.proxy = proxy;
        return defaults;
    };

    let _request = bluebird.promisify(require("request").defaults(buildRequestDefaults(null)));

    const setProxy = (url) => {
        _request = bluebird.promisify(require("request").defaults(buildRequestDefaults(url)));
        return _request;
    };

    const buildHeaders = (url, options, ctx, extra) => {
        const host = url.replace("https://", "").replace("http://", "").split("/")[0];
        const ua = options?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://www.facebook.com/",
            "Host": host,
            "Origin": "https://www.facebook.com",
            "User-Agent": ua,
            "Connection": "keep-alive",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "navigate"
        };
        if (extra) Object.assign(headers, extra);
        if (ctx?.region) headers["X-MSGR-Region"] = ctx.region;
        return headers;
    };

    const withRetry = (fn, maxRetries = 2, baseDelay = 1000) => {
        return async (...args) => {
            let lastError;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    return await fn(...args);
                } catch (e) {
                    lastError = e;
                    if (attempt < maxRetries) {
                        const jitter = Math.random() * 500;
                        await new Promise(r => setTimeout(r, baseDelay * Math.pow(1.5, attempt) + jitter));
                    }
                }
            }
            throw lastError;
        };
    };

    const get = (url, jar, qs, options, ctx) => {
        if (getType(qs) === "Object") {
            for (const prop in qs) {
                if (qs.hasOwnProperty(prop) && getType(qs[prop]) === "Object") {
                    qs[prop] = JSON.stringify(qs[prop]);
                }
            }
        }
        return _request({
            headers: buildHeaders(url, options, ctx),
            timeout: options?.requestTimeout || 60000,
            qs,
            url,
            method: "GET",
            jar,
            gzip: true,
            family: 4,
            agentOptions: { family: 4 }
        });
    };

    const post = (url, jar, form, options, ctx, customHeader) => {
        return _request({
            headers: buildHeaders(url, options, ctx, customHeader),
            timeout: options?.requestTimeout || 60000,
            url,
            method: "POST",
            form,
            jar,
            gzip: true,
            family: 4,
            agentOptions: { family: 4 }
        });
    };

    const postFormData = (url, jar, form, qs, options, ctx) => {
        const headers = buildHeaders(url, options, ctx);
        headers["Content-Type"] = "multipart/form-data";
        return _request({
            headers,
            timeout: options?.requestTimeout || 60000,
            url,
            method: "POST",
            formData: form,
            qs,
            jar,
            gzip: true,
            family: 4,
            agentOptions: { family: 4 }
        });
    };

    return { get, post, postFormData, setProxy, buildHeaders, withRetry, getJar: () => require("request").jar() };
})();

function getType(obj) {
    return Object.prototype.toString.call(obj).slice(8, -1);
}

function isReadableStream(obj) {
    return (
        obj instanceof stream.Stream &&
        (getType(obj._read) === "Function" || getType(obj._read) === "AsyncFunction") &&
        getType(obj._readableState) === "Object"
    );
}

const EncodingEngine = (() => {
    const TABLE = {
        _: "%", A: "%2", B: "000", C: "%7d", D: "%7b%22", E: "%2c%22",
        F: "%22%3a", G: "%2c%22ut%22%3a1", H: "%2c%22bls%22%3a",
        I: "%2c%22n%22%3a%22%", J: "%22%3a%7b%22i%22%3a0%7d",
        K: "%2c%22pt%22%3a0%2c%22vis%22%3a", L: "%2c%22ch%22%3a%7b%22h%22%3a%22",
        M: "%7b%22v%22%3a2%2c%22time%22%3a1", N: ".channel%22%2c%22sub%22%3a%5b",
        O: "%2c%22sb%22%3a1%2c%22t%22%3a%5b", P: "%2c%22ud%22%3a100%2c%22lc%22%3a0",
        Q: "%5d%2c%22f%22%3anull%2c%22uct%22%3a", R: ".channel%22%2c%22sub%22%3a%5b1%5d",
        S: "%22%2c%22m%22%3a0%7d%2c%7b%22i%22%3a", T: "%2c%22blc%22%3a1%2c%22snd%22%3a1%2c%22ct%22%3a",
        U: "%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a", V: "%2c%22blc%22%3a0%2c%22snd%22%3a0%2c%22ct%22%3a",
        W: "%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a",
        X: "%2c%22ri%22%3a0%7d%2c%22state%22%3a%7b%22p%22%3a0%2c%22ut%22%3a1",
        Y: "%2c%22pt%22%3a0%2c%22vis%22%3a1%2c%22bls%22%3a0%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a",
        Z: "%2c%22sb%22%3a1%2c%22t%22%3a%5b%5d%2c%22f%22%3anull%2c%22uct%22%3a0%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a"
    };

    const reverse = {};
    const tokens = [];
    for (const key in TABLE) {
        reverse[TABLE[key]] = key;
        tokens.push(TABLE[key]);
    }
    tokens.reverse();
    const pattern = new RegExp(tokens.join("|"), "g");

    const encode = (str) => {
        return encodeURIComponent(str)
            .replace(/([_A-Z])|%../g, (m, n) => n ? "%" + n.charCodeAt(0).toString(16) : m)
            .toLowerCase()
            .replace(pattern, (m) => reverse[m]);
    };

    const decode = (str) => {
        return decodeURIComponent(str.replace(/[_A-Z]/g, (m) => TABLE[m]));
    };

    const generatePresence = (userID) => {
        const time = Date.now();
        return "E" + encode(JSON.stringify({
            v: 3,
            time: parseInt(time / 1000, 10),
            user: userID,
            state: {
                ut: 0, t2: [], lm2: null,
                uct2: time, tr: null,
                tw: Math.floor(Math.random() * 4294967295) + 1,
                at: time
            },
            ch: { [`p_${userID}`]: 0 }
        }));
    };

    const generateAccessibilityCookie = () => {
        const time = Date.now();
        return encodeURIComponent(JSON.stringify({
            sr: 0, "sr-ts": time, jk: 0, "jk-ts": time,
            kb: 0, "kb-ts": time, hcm: 0, "hcm-ts": time
        }));
    };

    const binaryToDecimal = (data) => {
        let ret = "";
        while (data !== "0") {
            let end = 0;
            let fullName = "";
            for (let i = 0; i < data.length; i++) {
                end = 2 * end + parseInt(data[i], 10);
                fullName += end >= 10 ? (end -= 10, "1") : "0";
            }
            ret = end.toString() + ret;
            data = fullName.slice(fullName.indexOf("1"));
        }
        return ret;
    };

    const generateOfflineThreadingID = () => {
        const ret = Date.now();
        const value = Math.floor(Math.random() * 4294967295);
        const str = ("0000000000000000000000" + value.toString(2)).slice(-22);
        return binaryToDecimal(ret.toString(2) + str);
    };

    const generateThreadingID = (clientID) => {
        const k = Date.now();
        const l = Math.floor(Math.random() * 4294967295);
        return `<${k}:${l}-${clientID}@mail.projektitan.com>`;
    };

    const getGUID = () => {
        let sectionLength = Date.now();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = Math.floor((sectionLength + Math.random() * 16) % 16);
            sectionLength = Math.floor(sectionLength / 16);
            return (c === "x" ? r : (r & 7) | 8).toString(16);
        });
    };

    const getSignatureID = () => Math.floor(Math.random() * 2147483648).toString(16);

    const generateSessionId = () => {
        return crypto.randomBytes(16).toString('hex');
    };

    const generateRequestId = () => Math.random().toString(36).substring(2, 10);

    const generateHsi = () => Math.random().toString().substring(2, 21);

    const generateClientMutationId = () => Math.floor(Math.random() * 1000).toString();

    const generateSerializedState = (context) => {
        return Buffer.from(JSON.stringify({ context, timestamp: Date.now() })).toString('base64');
    };

    const generateSessionString = () => {
        return [
            Math.random().toString(36).substring(2, 8),
            Math.random().toString(36).substring(2, 8),
            Math.random().toString(36).substring(2, 8)
        ].join(':');
    };

    const generateUuid = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    };

    return {
        encode, decode, generatePresence, generateAccessibilityCookie,
        binaryToDecimal, generateOfflineThreadingID, generateThreadingID,
        getGUID, getSignatureID, generateSessionId, generateRequestId,
        generateHsi, generateClientMutationId, generateSerializedState,
        generateSessionString, generateUuid
    };
})();

const IDProcessor = {
    format: (id) => {
        if (id == null) return id;
        return String(id).replace(/(fb)?id[:.]/, "");
    },

    padZeros: (val, len = 2) => {
        val = String(val);
        while (val.length < len) val = "0" + val;
        return val;
    }
};

const AttachmentProcessor = (() => {
    const formatSingle = (a1, a2) => {
        a2 = a2 || { id: "", image_data: {} };
        a1 = a1.mercury ? a1.mercury : a1;

        let blob = a1.blob_attachment;
        let type = blob && blob.__typename ? blob.__typename : a1.attach_type;

        if (!type && a1.sticker_attachment) {
            type = "StickerAttachment";
            blob = a1.sticker_attachment;
        } else if (!type && a1.extensible_attachment) {
            const target = a1.extensible_attachment.story_attachment?.target;
            type = (target?.__typename === "MessageLocation") ? "MessageLocation" : "ExtensibleAttachment";
            blob = a1.extensible_attachment;
        }

        const handlers = {
            sticker: () => ({
                type: "sticker",
                ID: a1.metadata.stickerID.toString(),
                url: a1.url,
                packID: a1.metadata.packID.toString(),
                spriteUrl: a1.metadata.spriteURI,
                spriteUrl2x: a1.metadata.spriteURI2x,
                width: a1.metadata.width,
                height: a1.metadata.height,
                caption: a2.caption,
                description: a2.description,
                frameCount: a1.metadata.frameCount,
                frameRate: a1.metadata.frameRate,
                framesPerRow: a1.metadata.framesPerRow,
                framesPerCol: a1.metadata.framesPerCol,
                stickerID: a1.metadata.stickerID.toString(),
                spriteURI: a1.metadata.spriteURI,
                spriteURI2x: a1.metadata.spriteURI2x
            }),

            file: () => ({
                type: "file",
                filename: a1.name,
                ID: a2.id.toString(),
                url: a1.url,
                isMalicious: a2.is_malicious,
                contentType: a2.mime_type,
                name: a1.name,
                mimeType: a2.mime_type,
                fileSize: a2.file_size
            }),

            photo: () => ({
                type: "photo",
                ID: a1.metadata.fbid.toString(),
                filename: a1.fileName,
                thumbnailUrl: a1.thumbnail_url,
                previewUrl: a1.preview_url,
                previewWidth: a1.preview_width,
                previewHeight: a1.preview_height,
                largePreviewUrl: a1.large_preview_url,
                largePreviewWidth: a1.large_preview_width,
                largePreviewHeight: a1.large_preview_height,
                url: a1.metadata.url,
                width: a1.metadata.dimensions?.split(",")?.[0],
                height: a1.metadata.dimensions?.split(",")?.[1],
                name: a1.fileName
            }),

            animated_image: () => ({
                type: "animated_image",
                ID: a2.id.toString(),
                filename: a2.filename,
                previewUrl: a1.preview_url,
                previewWidth: a1.preview_width,
                previewHeight: a1.preview_height,
                url: a2.image_data.url,
                width: a2.image_data.width,
                height: a2.image_data.height,
                name: a1.name,
                facebookUrl: a1.url,
                thumbnailUrl: a1.thumbnail_url,
                mimeType: a2.mime_type,
                rawGifImage: a2.image_data.raw_gif_image,
                rawWebpImage: a2.image_data.raw_webp_image,
                animatedGifUrl: a2.image_data.animated_gif_url,
                animatedGifPreviewUrl: a2.image_data.animated_gif_preview_url,
                animatedWebpUrl: a2.image_data.animated_webp_url,
                animatedWebpPreviewUrl: a2.image_data.animated_webp_preview_url
            }),

            share: () => ({
                type: "share",
                ID: a1.share.share_id.toString(),
                url: a2.href,
                title: a1.share.title,
                description: a1.share.description,
                source: a1.share.source,
                image: a1.share.media?.image,
                width: a1.share.media?.image_size?.width,
                height: a1.share.media?.image_size?.height,
                playable: a1.share.media?.playable,
                duration: a1.share.media?.duration,
                subattachments: a1.share.subattachments,
                properties: {},
                animatedImageSize: a1.share.media?.animated_image_size,
                facebookUrl: a1.share.uri,
                target: a1.share.target,
                styleList: a1.share.style_list
            }),

            video: () => ({
                type: "video",
                ID: a1.metadata.fbid.toString(),
                filename: a1.name,
                previewUrl: a1.preview_url,
                previewWidth: a1.preview_width,
                previewHeight: a1.preview_height,
                url: a1.url,
                width: a1.metadata.dimensions?.width,
                height: a1.metadata.dimensions?.height,
                duration: a1.metadata.duration,
                videoType: "unknown",
                thumbnailUrl: a1.thumbnail_url
            }),

            error: () => ({ type: "error", attachment1: a1, attachment2: a2 }),

            MessageImage: () => ({
                type: "photo",
                ID: blob.legacy_attachment_id,
                filename: blob.filename,
                thumbnailUrl: blob.thumbnail?.uri,
                previewUrl: blob.preview?.uri,
                previewWidth: blob.preview?.width,
                previewHeight: blob.preview?.height,
                largePreviewUrl: blob.large_preview?.uri,
                largePreviewWidth: blob.large_preview?.width,
                largePreviewHeight: blob.large_preview?.height,
                url: blob.large_preview?.uri,
                width: blob.original_dimensions?.x,
                height: blob.original_dimensions?.y,
                name: blob.filename
            }),

            MessageAnimatedImage: () => ({
                type: "animated_image",
                ID: blob.legacy_attachment_id,
                filename: blob.filename,
                previewUrl: blob.preview_image?.uri,
                previewWidth: blob.preview_image?.width,
                previewHeight: blob.preview_image?.height,
                url: blob.animated_image?.uri,
                width: blob.animated_image?.width,
                height: blob.animated_image?.height,
                thumbnailUrl: blob.preview_image?.uri,
                name: blob.filename,
                facebookUrl: blob.animated_image?.uri,
                rawGifImage: blob.animated_image?.uri,
                animatedGifUrl: blob.animated_image?.uri,
                animatedGifPreviewUrl: blob.preview_image?.uri,
                animatedWebpUrl: blob.animated_image?.uri,
                animatedWebpPreviewUrl: blob.preview_image?.uri
            }),

            MessageVideo: () => ({
                type: "video",
                filename: blob.filename,
                ID: blob.legacy_attachment_id,
                previewUrl: blob.large_image?.uri,
                previewWidth: blob.large_image?.width,
                previewHeight: blob.large_image?.height,
                url: blob.playable_url,
                width: blob.original_dimensions?.x,
                height: blob.original_dimensions?.y,
                duration: blob.playable_duration_in_ms,
                videoType: blob.video_type?.toLowerCase?.() || "unknown",
                thumbnailUrl: blob.large_image?.uri
            }),

            MessageAudio: () => ({
                type: "audio",
                filename: blob.filename,
                ID: blob.url_shimhash,
                audioType: blob.audio_type,
                duration: blob.playable_duration_in_ms,
                url: blob.playable_url,
                isVoiceMail: blob.is_voicemail
            }),

            StickerAttachment: () => ({
                type: "sticker",
                ID: blob.id,
                url: blob.url,
                packID: blob.pack ? blob.pack.id : null,
                spriteUrl: blob.sprite_image,
                spriteUrl2x: blob.sprite_image_2x,
                width: blob.width,
                height: blob.height,
                caption: blob.label,
                description: blob.label,
                frameCount: blob.frame_count,
                frameRate: blob.frame_rate,
                framesPerRow: blob.frames_per_row,
                framesPerCol: blob.frames_per_column,
                stickerID: blob.id,
                spriteURI: blob.sprite_image,
                spriteURI2x: blob.sprite_image_2x
            }),

            MessageLocation: () => {
                const urlAttach = blob.story_attachment?.url;
                const mediaAttach = blob.story_attachment?.media;
                const u = querystring.parse(urlModule.parse(urlAttach).query).u;
                const where1 = querystring.parse(urlModule.parse(u).query).where1;
                const parts = where1?.split(", ") || [];
                let latitude, longitude;
                try { latitude = parseFloat(parts[0]); longitude = parseFloat(parts[1]); } catch (_) {}
                return {
                    type: "location",
                    ID: blob.legacy_attachment_id,
                    latitude,
                    longitude,
                    image: mediaAttach?.image?.uri,
                    width: mediaAttach?.image?.width,
                    height: mediaAttach?.image?.height,
                    url: u || urlAttach,
                    address: where1,
                    facebookUrl: blob.story_attachment?.url,
                    target: blob.story_attachment?.target,
                    styleList: blob.story_attachment?.style_list
                };
            },

            ExtensibleAttachment: () => ({
                type: "share",
                ID: blob.legacy_attachment_id,
                url: blob.story_attachment?.url,
                title: blob.story_attachment?.title_with_entities?.text,
                description: blob.story_attachment?.description?.text,
                source: blob.story_attachment?.source?.text || null,
                image: blob.story_attachment?.media?.image?.uri,
                width: blob.story_attachment?.media?.image?.width,
                height: blob.story_attachment?.media?.image?.height,
                playable: blob.story_attachment?.media?.is_playable,
                duration: blob.story_attachment?.media?.playable_duration_in_ms,
                playableUrl: blob.story_attachment?.media?.playable_url || null,
                subattachments: blob.story_attachment?.subattachments,
                properties: (blob.story_attachment?.properties || []).reduce((obj, cur) => {
                    obj[cur.key] = cur.value?.text;
                    return obj;
                }, {}),
                facebookUrl: blob.story_attachment?.url,
                target: blob.story_attachment?.target,
                styleList: blob.story_attachment?.style_list
            }),

            MessageFile: () => ({
                type: "file",
                filename: blob.filename,
                ID: blob.message_file_fbid,
                url: blob.url,
                isMalicious: blob.is_malicious,
                contentType: blob.content_type,
                name: blob.filename,
                mimeType: "",
                fileSize: -1
            })
        };

        const handler = handlers[type];
        if (handler) return handler();
        throw new Error(`Unrecognized attachment type: ${type}\n${JSON.stringify(a1, null, 2)}`);
    };

    const format = (attachments, attachmentIds, attachmentMap, shareMap) => {
        const map = shareMap || attachmentMap;
        return (attachments || []).map((val, i) => {
            if (!map || !attachmentIds || !map[attachmentIds[i]]) return formatSingle(val);
            return formatSingle(val, map[attachmentIds[i]]);
        });
    };

    return { formatSingle, format };
})();

const MessageFormatter = (() => {
    const getAdminTextType = (m) => {
        const typeMap = {
            joinable_group_link_mode_change: "log:link-status",
            magic_words: "log:magic-words",
            change_thread_theme: "log:thread-color",
            change_thread_icon: "log:thread-icon",
            change_thread_nickname: "log:user-nickname",
            change_thread_admins: "log:thread-admins",
            group_poll: "log:thread-poll",
            change_thread_approval_mode: "log:thread-approval-mode",
            messenger_call_log: "log:thread-call",
            participant_joined_group_call: "log:thread-call",
            pin_messages_v2: "log:thread-pinned",
            change_thread_name: "log:thread-name"
        };
        return typeMap[m?.type] || m?.type;
    };

    const formatDeltaMessage = (m) => {
        const md = m.delta.messageMetadata;
        const mdata = m.delta.data === undefined ? [] : m.delta.data.prng === undefined ? [] : JSON.parse(m.delta.data.prng);
        const m_id = mdata.map(u => u.i);
        const m_offset = mdata.map(u => u.o);
        const m_length = mdata.map(u => u.l);
        const mentions = {};
        const body = m.delta.body || "";
        const args = body === "" ? [] : body.trim().split(/\s+/);
        for (let i = 0; i < m_id.length; i++) {
            mentions[m_id[i]] = m.delta.body.substring(m_offset[i], m_offset[i] + m_length[i]);
        }
        return {
            type: "message",
            senderID: IDProcessor.format(md.actorFbId.toString()),
            threadID: IDProcessor.format((md.threadKey.threadFbId || md.threadKey.otherUserFbId).toString()),
            messageID: md.messageId,
            args,
            body,
            attachments: (m.delta.attachments || []).map(v => AttachmentProcessor.formatSingle(v)),
            mentions,
            timestamp: md.timestamp,
            isGroup: !!md.threadKey.threadFbId,
            participantIDs: m.delta.participants || md.cid?.canonicalParticipantFbids || []
        };
    };

    const formatMessage = (m) => {
        const orig = m.message || m;
        const obj = {
            type: "message",
            senderName: orig.sender_name,
            senderID: IDProcessor.format(orig.sender_fbid.toString()),
            participantNames: orig.group_thread_info
                ? orig.group_thread_info.participant_names
                : [orig.sender_name?.split(" ")?.[0]],
            participantIDs: orig.group_thread_info
                ? orig.group_thread_info.participant_ids.map(v => IDProcessor.format(v.toString()))
                : [IDProcessor.format(orig.sender_fbid)],
            body: orig.body || "",
            threadID: IDProcessor.format((orig.thread_fbid || orig.other_user_fbid).toString()),
            threadName: orig.group_thread_info ? orig.group_thread_info.name : orig.sender_name,
            location: orig.coordinates || null,
            messageID: orig.mid ? orig.mid.toString() : orig.message_id,
            attachments: AttachmentProcessor.format(orig.attachments, orig.attachmentIds, orig.attachment_map, orig.share_map),
            timestamp: orig.timestamp,
            timestampAbsolute: orig.timestamp_absolute,
            timestampRelative: orig.timestamp_relative,
            timestampDatetime: orig.timestamp_datetime,
            tags: orig.tags,
            reactions: orig.reactions || [],
            isUnread: orig.is_unread
        };
        if (m.type === "pages_messaging") obj.pageID = m.realtime_viewer_fbid?.toString();
        obj.isGroup = obj.participantIDs.length > 2;
        return obj;
    };

    const formatEvent = (m) => {
        const orig = m.message || m;
        let logMessageType = orig.log_message_type;
        let logMessageData;
        if (logMessageType === "log:generic-admin-text") {
            logMessageData = orig.log_message_data.untypedData;
            logMessageType = getAdminTextType(orig.log_message_data.message_type);
        } else {
            logMessageData = orig.log_message_data;
        }
        return Object.assign(formatMessage(orig), {
            type: "event",
            logMessageType,
            logMessageData,
            logMessageBody: orig.log_message_body
        });
    };

    const formatHistoryMessage = (m) => {
        return m.action_type === "ma-type:log-message" ? formatEvent(m) : formatMessage(m);
    };

    const formatDeltaEvent = (m) => {
        let logMessageType, logMessageData;
        switch (m.class) {
            case "JoinableMode":
                if (m.mode) return;
                logMessageType = "joinable_group_link_reset";
                logMessageData = { link: m.link };
                break;
            case "AdminTextMessage":
                logMessageType = getAdminTextType(m);
                logMessageData = m.untypedData;
                break;
            case "ThreadName":
                logMessageType = "log:thread-name";
                logMessageData = { name: m.name };
                break;
            case "ParticipantsAddedToGroupThread":
                logMessageType = "log:subscribe";
                logMessageData = { addedParticipants: m.addedParticipants };
                break;
            case "ParticipantLeftGroupThread":
                logMessageType = "log:unsubscribe";
                logMessageData = { leftParticipantFbId: m.leftParticipantFbId };
                break;
        }
        return {
            type: "event",
            threadID: IDProcessor.format((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),
            logMessageType,
            logMessageData,
            logMessageBody: m.messageMetadata.adminText,
            author: m.messageMetadata.actorFbId,
            participantIDs: (m.participants || []).map(p => p.toString())
        };
    };

    const formatTyp = (event) => ({
        isTyping: !!event.st,
        from: event.from.toString(),
        threadID: IDProcessor.format((event.to || event.thread_fbid || event.from).toString()),
        fromMobile: event.hasOwnProperty("from_mobile") ? event.from_mobile : true,
        userID: (event.realtime_viewer_fbid || event.from).toString(),
        type: "typ"
    });

    const formatReadReceipt = (event) => ({
        reader: event.reader.toString(),
        time: event.time,
        threadID: IDProcessor.format((event.thread_fbid || event.reader).toString()),
        type: "read_receipt"
    });

    const formatRead = (event) => ({
        threadID: IDProcessor.format(((event.chat_ids?.[0]) || (event.thread_fbids?.[0]))?.toString()),
        time: event.timestamp,
        type: "read"
    });

    return {
        getAdminTextType, formatDeltaMessage, formatMessage, formatEvent,
        formatHistoryMessage, formatDeltaEvent, formatTyp, formatReadReceipt, formatRead
    };
})();

const ThreadFormatter = {
    format: (data) => ({
        threadID: IDProcessor.format(data.thread_fbid.toString()),
        participants: data.participants.map(IDProcessor.format),
        participantIDs: data.participants.map(IDProcessor.format),
        name: data.name,
        nicknames: data.custom_nickname,
        snippet: data.snippet,
        snippetAttachments: data.snippet_attachments,
        snippetSender: IDProcessor.format((data.snippet_sender || "").toString()),
        unreadCount: data.unread_count,
        messageCount: data.message_count,
        imageSrc: data.image_src,
        timestamp: data.timestamp,
        muteUntil: data.mute_until,
        isCanonicalUser: data.is_canonical_user,
        isCanonical: data.is_canonical,
        isSubscribed: data.is_subscribed,
        folder: data.folder,
        isArchived: data.is_archived,
        recipientsLoadable: data.recipients_loadable,
        hasEmailParticipant: data.has_email_participant,
        readOnly: data.read_only,
        canReply: data.can_reply,
        cannotReplyReason: data.cannot_reply_reason,
        lastMessageTimestamp: data.last_message_timestamp,
        lastReadTimestamp: data.last_read_timestamp,
        lastMessageType: data.last_message_type,
        emoji: data.custom_like_icon,
        color: data.custom_color,
        adminIDs: data.admin_ids,
        threadType: data.thread_type
    })
};

const PresenceFormatter = {
    formatProxy: (presence, userID) => {
        if (presence.lat === undefined || presence.p === undefined) return null;
        return { type: "presence", timestamp: presence.lat * 1000, userID: userID || '', statuses: presence.p };
    },
    format: (presence, userID) => ({
        type: "presence",
        timestamp: presence.la * 1000,
        userID: userID || '',
        statuses: presence.a
    })
};

const CookieEngine = {
    format: (arr, url) => `${arr[0]}=${arr[1]}; Path=${arr[3]}; Domain=${url}.com`,

    save: (jar) => (res) => {
        const cookies = res.headers?.["set-cookie"] || [];
        cookies.forEach(c => {
            if (c.indexOf(".facebook.com") > -1) {
                jar.setCookie(c, "https://www.facebook.com");
                jar.setCookie(c.replace(/domain=\.facebook\.com/, "domain=.messenger.com"), "https://www.messenger.com");
            }
        });
        return res;
    },

    getAppState: (jar) => {
        return jar.getCookies("https://www.facebook.com")
            .concat(jar.getCookies("https://facebook.com"))
            .concat(jar.getCookies("https://www.messenger.com"));
    }
};

const DataAccessor = {
    get: (obj, pathArr, defaultVal) => {
        if (pathArr.length === 0 && obj !== undefined) return obj;
        if (obj === undefined) return defaultVal;
        const [head, ...tail] = pathArr;
        if (head === undefined) return defaultVal;
        return DataAccessor.get(obj[head], tail, defaultVal);
    },

    set: (obj, pathArr, value) => {
        if (!pathArr.length) return obj;
        const currentKey = pathArr[0];
        if (!obj[currentKey]) obj[currentKey] = value;
        const remaining = pathArr.slice(1);
        if (!remaining.length) {
            obj[currentKey] = value;
        } else {
            DataAccessor.set(obj[currentKey], remaining, value);
        }
        return obj;
    },

    paths: (obj, parentPath = []) => {
        let paths = [];
        for (const prop in obj) {
            if (typeof obj[prop] === "object" && obj[prop] !== null) {
                paths = paths.concat(DataAccessor.paths(obj[prop], [...parentPath, prop]));
            } else {
                paths.push([...parentPath, prop]);
            }
        }
        return paths;
    }
};

const HTMLProcessor = {
    makeParsable: (html) => {
        const stripped = html.replace(/for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
        const parts = stripped.split(/\}\r\n *\{/);
        if (parts.length === 1) return parts;
        return "[" + parts.join("},{") + "]";
    },

    getFrom: (str, startToken, endToken) => {
        const start = str.indexOf(startToken) + startToken.length;
        if (start < startToken.length) return "";
        const lastHalf = str.substring(start);
        const end = lastHalf.indexOf(endToken);
        if (end === -1) throw new Error(`Could not find endToken \`${endToken}\` in string`);
        return lastHalf.substring(0, end);
    },

    cleanHTML: (text) => {
        const replacements = {
            "<br>": "\n", "<i>": "*", "</i>": "*", "<em>": "*", "</em>": "*",
            "<b>": "**", "</b>": "**", "~!": "||", "!~": "||",
            "&amp;": "&", "&#039;": "'", "&lt;": "<", "&gt;": ">", "&quot;": '"'
        };
        return text.replace(/(<br>)|(<\/?i>)|(<\/?em>)|(<\/?b>)|(!?~)|(&amp;)|(&#039;)|(&lt;)|(&gt;)|(&quot;)/g,
            (match) => replacements[match] || match
        );
    },

    decodeClientPayload: (payload) => {
        const Utf8ArrayToStr = (array) => {
            let out = "", i = 0;
            while (i < array.length) {
                const c = array[i++];
                switch (c >> 4) {
                    case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                        out += String.fromCharCode(c); break;
                    case 12: case 13: {
                        const c2 = array[i++];
                        out += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
                        break;
                    }
                    case 14: {
                        const c2 = array[i++], c3 = array[i++];
                        out += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
                        break;
                    }
                }
            }
            return out;
        };
        return JSON.parse(Utf8ArrayToStr(payload));
    }
};

const FormUtils = {
    arrToForm: (form) => {
        return form.reduce((acc, val) => {
            acc[val.name] = val.val;
            return acc;
        }, {});
    },

    arrayToObject: (arr, getKey, getValue) => {
        return arr.reduce((acc, val) => {
            acc[getKey(val)] = getValue(val);
            return acc;
        }, {});
    }
};

const TimeUtils = {
    formatDate: (date) => {
        const NUM_TO_MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const NUM_TO_DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const d = String(date.getUTCDate()).padStart(2, '0');
        const h = String(date.getUTCHours()).padStart(2, '0');
        const m = String(date.getUTCMinutes()).padStart(2, '0');
        const s = String(date.getUTCSeconds()).padStart(2, '0');
        return `${NUM_TO_DAY[date.getUTCDay()]}, ${d} ${NUM_TO_MONTH[date.getUTCMonth()]} ${date.getUTCFullYear()} ${h}:${m}:${s} GMT`;
    },

    generateTimestampRelative: () => {
        const d = new Date();
        return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
};

const GenderDetector = (() => {
    const FEMALE_NAMES = new Set([
        "Phương Chi","An Bình","An Di","An Hạ","An Hằng","An Khê","An Nhiên","An Nhàn","Anh Chi","Anh Hương","Anh Mai","Anh Phương","Anh Thi","Anh Thy","Anh Thơ","Anh Thư","Anh Thảo","Anh Vũ","Anh Ðào","Ban Mai","Bình Minh","Bình Yên","Bích Chiêu","Bích Châu","Bích Duyên","Bích Hiền","Bích Huệ","Bích Hà","Bích Hạnh","Bích Hải","Bích Hảo","Bích Hậu","Bích Hằng","Bích Hồng","Bích Hợp","Bích Lam","Bích Liên","Bích Loan","Bích Nga","Bích Ngà","Bích Ngân","Bích Ngọc","Bích Như","Bích Phượng","Bích Quyên","Bích Quân","Bích San","Bích Thoa","Bích Thu","Bích Thảo","Bích Thủy","Bích Trang","Bích Trâm","Bích Ty","Bích Vân","Bích Ðiệp","Bích Ðào","Băng Băng","Băng Tâm","Bạch Cúc","Bạch Hoa","Bạch Kim","Bạch Liên","Bạch Loan","Bạch Mai","Bạch Quỳnh","Bạch Trà","Bạch Tuyết","Bạch Vân","Bạch Yến","Bảo Anh","Bảo Bình","Bảo Châu","Bảo Huệ","Bảo Hà","Bảo Hân","Bảo Lan","Bảo Lễ","Bảo Ngọc","Bảo Phương","Bảo Quyên","Bảo Quỳnh","Bảo Thoa","Bảo Thúy","Bảo Tiên","Bảo Trâm","Bảo Trân","Bảo Trúc","Bảo Uyên","Bảo Vy","Bảo Vân","Bội Linh","Cam Thảo","Chi Lan","Chi Mai","Chiêu Dương","Cát Cát","Cát Linh","Cát Ly","Cát Tiên","Cát Tường","Cẩm Hiền","Cẩm Hường","Cẩm Hạnh","Cẩm Linh","Cẩm Liên","Cẩm Ly","Cẩm Nhi","Cẩm Nhung","Cẩm Thúy","Cẩm Tú","Cẩm Vân","Cẩm Yến","Di Nhiên","Diên Vỹ","Diễm Chi","Diễm Châu","Diễm Hương","Diễm Hạnh","Diễm Hằng","Diễm Khuê","Diễm Kiều","Diễm Liên","Diễm Lộc","Diễm My","Diễm Phúc","Diễm Phương","Diễm Phước","Diễm Phượng","Diễm Quyên","Diễm Quỳnh","Diễm Thúy","Diễm Thư","Diễm Thảo","Diễm Trang","Diễm Trinh","Diễm Uyên","Diệp Anh","Diệp Vy","Diệu Anh","Diệu Hiền","Diệu Hoa","Diệu Huyền","Diệu Hương","Diệu Hạnh","Diệu Hằng","Diệu Hồng","Diệu Lan","Diệu Linh","Diệu Loan","Diệu Nga","Diệu Ngà","Diệu Ngọc","Diệu Nương","Diệu Thiện","Diệu Thúy","Diệu Vân","Diệu Ái","Duy Hạnh","Duy Mỹ","Duy Uyên","Duyên Hồng","Duyên My","Duyên Mỹ","Duyên Nương","Dã Lan","Dã Lâm","Dã Thảo","Dạ Hương","Dạ Lan","Dạ Nguyệt","Dạ Thi","Dạ Thảo","Dạ Yến","Gia Hân","Gia Khanh","Gia Linh","Gia Nhi","Gia Quỳnh","Giang Thanh","Giang Thiên","Giao Hưởng","Giao Kiều","Giao Linh","Giáng Ngọc","Giáng Tiên","Giáng Uyên","Hiếu Giang","Hiếu Hạnh","Hiếu Khanh","Hiếu Minh","Hiền Chung","Hiền Hòa","Hiền Mai","Hiền Nhi","Hiền Nương","Hiền Thục","Hiểu Lam","Hiểu Vân","Hoa Liên","Hoa Lý","Hoa Thiên","Hoa Tiên","Hoa Tranh","Hoài An","Hoài Giang","Hoài Hương","Hoài Phương","Hoài Thương","Hoài Trang","Hoài Vỹ","Hoàn Châu","Hoàn Vi","Hoàng Cúc","Hoàng Hà","Hoàng Kim","Hoàng Lan","Hoàng Mai","Hoàng Miên","Hoàng Nguyên","Hoàng Oanh","Hoàng Sa","Hoàng Thư","Hoàng Xuân","Hoàng Yến","Hoạ Mi","Huyền Anh","Huyền Diệu","Huyền Linh","Huyền Ngọc","Huyền Nhi","Huyền Thoại","Huyền Thư","Huyền Trang","Huyền Trâm","Huyền Trân","Huệ An","Huệ Hương","Huệ Hồng","Huệ Lan","Huệ Linh","Huệ Lâm","Huệ My","Huệ Phương","Huệ Thương","Huệ Ân","Huỳnh Anh","Hà Giang","Hà Liên","Hà Mi","Hà My","Hà Nhi","Hà Phương","Hà Thanh","Hà Tiên","Hàm Duyên","Hàm Nghi","Hàm Thơ","Hàm Ý","Hương Chi","Hương Giang","Hương Lan","Hương Liên","Hương Ly","Hương Lâm","Hương Mai","Hương Nhi","Hương Thu","Hương Thảo","Hương Thủy","Hương Tiên","Hương Trang","Hương Trà","Hương Xuân","Hướng Dương","Hạ Băng","Hạ Giang","Hạ Phương","Hạ Tiên","Hạ Uyên","Hạ Vy","Hạc Cúc","Hạnh Chi","Hạnh Dung","Hạnh Linh","Hạnh My","Hạnh Nga","Hạnh Nhơn","Hạnh Phương","Hạnh San","Hạnh Thảo","Hạnh Trang","Hạnh Vi","Hải Anh","Hải Châu","Hải Duyên","Hải Dương","Hải Miên","Hải My","Hải Mỹ","Hải Ngân","Hải Nhi","Hải Phương","Hải Phượng","Hải San","Hải Sinh","Hải Thanh","Hải Thảo","Hải Thụy","Hải Uyên","Hải Vy","Hải Vân","Hải Yến","Hải Ân","Hải Ðường","Hảo Nhi","Hằng Anh","Hằng Nga","Họa Mi","Hồ Diệp","Hồng Anh","Hồng Bạch Thảo","Hồng Châu","Hồng Diễm","Hồng Giang","Hồng Hoa","Hồng Hà","Hồng Hạnh","Hồng Khanh","Hồng Khuê","Hồng Khôi","Hồng Linh","Hồng Liên","Hồng Lâm","Hồng Mai","Hồng Nga","Hồng Ngân","Hồng Ngọc","Hồng Nhung","Hồng Như","Hồng Nhạn","Hồng Oanh","Hồng Phúc","Hồng Phương","Hồng Quế","Hồng Thu","Hồng Thúy","Hồng Thư","Hồng Thảo","Hồng Thắm","Hồng Thủy","Hồng Trúc","Hồng Tâm","Hồng Vân","Hồng Xuân","Hồng Ðiệp","Hồng Ðào","Hồng Đăng","Khiết Linh","Khiết Tâm","Khuê Trung","Khánh Chi","Khánh Giang","Khánh Giao","Khánh Huyền","Khánh Hà","Khánh Hằng","Khánh Linh","Khánh Ly","Khánh Mai","Khánh My","Khánh Ngân","Khánh Ngọc","Khánh Quyên","Khánh Quỳnh","Khánh Thủy","Khánh Trang","Khánh Vi","Khánh Vy","Khánh Vân","Khúc Lan","Khả Khanh","Khả Tú","Khả Ái","Khải Ca","Khải Hà","Khải Tâm","Kim Anh","Kim Chi","Kim Cương","Kim Dung","Kim Duyên","Kim Hoa","Kim Hương","Kim Khanh","Kim Khuyên","Kim Khánh","Kim Lan","Kim Liên","Kim Loan","Kim Ly","Kim Mai","Kim Ngân","Kim Ngọc","Kim Oanh","Kim Phượng","Kim Quyên","Kim Sa","Kim Thanh","Kim Thoa","Kim Thu","Kim Thy","Kim Thông","Kim Thư","Kim Thảo","Kim Thủy","Kim Trang","Kim Tuyến","Kim Tuyết","Kim Tuyền","Kim Xuyến","Kim Xuân","Kim Yến","Kim Ánh","Kim Đan","Kiết Hồng","Kiết Trinh","Kiều Anh","Kiều Diễm","Kiều Dung","Kiều Giang","Kiều Hoa","Kiều Hạnh","Kiều Khanh","Kiều Loan","Kiều Mai","Kiều Minh","Kiều Mỹ","Kiều Nga","Kiều Nguyệt","Kiều Nương","Kiều Thu","Kiều Trang","Kiều Trinh","Kỳ Anh","Kỳ Diệu","Kỳ Duyên","Lam Giang","Lam Hà","Lam Khê","Lam Ngọc","Lam Tuyền","Lan Anh","Lan Chi","Lan Hương","Lan Khuê","Lan Ngọc","Lan Nhi","Lan Phương","Lan Thương","Lan Trúc","Lan Vy","Linh Chi","Linh Châu","Linh Duyên","Linh Giang","Linh Hà","Linh Lan","Linh Nhi","Linh Phương","Linh Phượng","Linh San","Linh Trang","Linh Ðan","Liên Chi","Liên Hoa","Liên Hương","Liên Như","Liên Phương","Liên Trân","Liễu Oanh","Loan Châu","Ly Châu","Lâm Nhi","Lâm Oanh","Lâm Tuyền","Lâm Uyên","Lê Quỳnh","Lưu Ly","Lệ Băng","Lệ Chi","Lệ Giang","Lệ Hoa","Lệ Huyền","Lệ Khanh","Lệ Nga","Lệ Nhi","Lệ Quyên","Lệ Quân","Lệ Thanh","Lệ Thu","Lệ Thủy","Lộc Uyên","Lộc Uyển","Lục Bình","Mai Anh","Mai Chi","Mai Châu","Mai Hiền","Mai Hà","Mai Hương","Mai Hạ","Mai Khanh","Mai Khôi","Mai Lan","Mai Linh","Mai Liên","Mai Loan","Mai Ly","Mai Nhi","Mai Phương","Mai Quyên","Mai Thanh","Mai Thu","Mai Thy","Mai Thảo","Mai Trinh","Mai Tâm","Mai Vy","Minh An","Minh Châu","Minh Duyên","Minh Hiền","Minh Huyền","Minh Huệ","Minh Hà","Minh Hương","Minh Hạnh","Minh Hằng","Minh Hồng","Minh Khanh","Minh Lan","Minh Linh","Minh Loan","Minh Ngọc","Minh Nguyệt","Minh Nhi","Minh Phương","Minh Thư","Minh Thảo","Minh Thủy","Minh Trang","Minh Tâm","Minh Uyên","Minh Vân","Minh Xuân","Minh Yến","Mộng Cầm","Mộng Hoài","Mộng Huyền","Mộng Lan","Mộng Linh","Mộng Loan","Mộng Ngọc","Mộng Nhi","Mộng Phương","Mộng Thu","Mộng Thường","Mộng Thủy","Mộng Trang","Mộng Tuyền","Mộng Tâm","Mộng Uyên","Mộng Vân","Mộng Ðiệp","Mỹ Anh","Mỹ Chi","Mỹ Châu","Mỹ Dung","Mỹ Duyên","Mỹ Giang","Mỹ Hoa","Mỹ Huyền","Mỹ Huệ","Mỹ Hà","Mỹ Hương","Mỹ Hạnh","Mỹ Hằng","Mỹ Hồng","Mỹ Khanh","Mỹ Lan","Mỹ Linh","Mỹ Liên","Mỹ Loan","Mỹ Lệ","Mỹ Nga","Mỹ Ngân","Mỹ Ngọc","Mỹ Nhi","Mỹ Nhung","Mỹ Nhàn","Mỹ Phương","Mỹ Quyên","Mỹ Thanh","Mỹ Thoa","Mỹ Thu","Mỹ Thúy","Mỹ Thư","Mỹ Thảo","Mỹ Thủy","Mỹ Tiên","Mỹ Trang","Mỹ Trinh","Mỹ Trâm","Mỹ Tuyết","Mỹ Tâm","Mỹ Uyên","Mỹ Vy","Mỹ Vân","Mỹ Xuân","Mỹ Yến","Ngân Hà","Ngân Hương","Ngân Khánh","Ngân Linh","Ngân Trang","Nguyệt Anh","Nguyệt Cầm","Nguyệt Hà","Nguyệt Hằng","Nguyệt Linh","Nguyệt Nga","Nguyệt Nhi","Nguyệt Trinh","Nguyệt Vân","Ngọc Anh","Ngọc Bích","Ngọc Chi","Ngọc Châu","Ngọc Diệp","Ngọc Dung","Ngọc Duyên","Ngọc Giàu","Ngọc Hoa","Ngọc Huyền","Ngọc Huệ","Ngọc Hà","Ngọc Hương","Ngọc Hạnh","Ngọc Hằng","Ngọc Hồng","Ngọc Khanh","Ngọc Lan","Ngọc Linh","Ngọc Liên","Ngọc Loan","Ngọc Lý","Ngọc Lê","Ngọc Nga","Ngọc Ngân","Ngọc Nhi","Ngọc Nhung","Ngọc Như","Ngọc Phương","Ngọc Quyên","Ngọc Quỳnh","Ngọc Thi","Ngọc Thu","Ngọc Thúy","Ngọc Thư","Ngọc Thảo","Ngọc Thủy","Ngọc Tiên","Ngọc Trang","Ngọc Trinh","Ngọc Trâm","Ngọc Tuyết","Ngọc Tâm","Ngọc Uyên","Ngọc Vân","Ngọc Xuân","Ngọc Yến","Như Hoa","Như Hà","Như Hương","Như Loan","Như Ngọc","Như Quỳnh","Như Thảo","Như Ý","Nhu Mì","Nhuần Nhuyễn","Nhã Linh","Nhã Uyên","Nhã Vân","Nhật Hà","Nhật Khanh","Nhật Linh","Nhật Ngân","Nhật Nhi","Nhật Thảo","Nhật Uyên","Phương Anh","Phương Chi","Phương Châu","Phương Dung","Phương Duyên","Phương Hoa","Phương Huyền","Phương Huệ","Phương Hà","Phương Hương","Phương Hạnh","Phương Hằng","Phương Khanh","Phương Lan","Phương Linh","Phương Liên","Phương Loan","Phương Nga","Phương Ngân","Phương Ngọc","Phương Nhi","Phương Nhung","Phương Quỳnh","Phương Thanh","Phương Thu","Phương Thúy","Phương Thư","Phương Thảo","Phương Thủy","Phương Tiên","Phương Trang","Phương Trinh","Phương Trâm","Phương Tâm","Phương Uyên","Phương Yến","Phước Bình","Phước Huệ","Phượng Bích","Phượng Liên","Phượng Loan","Phượng Lệ","Phượng Nga","Phượng Nhi","Phượng Tiên","Phượng Uyên","Phượng Vy","Phượng Vũ","Phụng Yến","Quế Anh","Quế Chi","Quế Linh","Quế Lâm","Quế Phương","Quế Thu","Quỳnh Anh","Quỳnh Chi","Quỳnh Dao","Quỳnh Dung","Quỳnh Giang","Quỳnh Giao","Quỳnh Hoa","Quỳnh Hà","Quỳnh Hương","Quỳnh Lam","Quỳnh Liên","Quỳnh Lâm","Quỳnh Nga","Quỳnh Ngân","Quỳnh Nhi","Quỳnh Nhung","Quỳnh Như","Quỳnh Phương","Quỳnh Sa","Quỳnh Thanh","Quỳnh Thơ","Quỳnh Tiên","Quỳnh Trang","Quỳnh Trâm","Quỳnh Vân","Sao Băng","Sao Mai","Song Kê","Song Lam","Song Oanh","Song Thư","Sông Hà","Sông Hương","Sơn Ca","Sơn Tuyền","Sương Sương","Thanh Bình","Thanh Dân","Thanh Giang","Thanh Hiếu","Thanh Hiền","Thanh Hoa","Thanh Huyền","Thanh Hà","Thanh Hương","Thanh Hường","Thanh Hạnh","Thanh Hảo","Thanh Hằng","Thanh Hồng","Thanh Kiều","Thanh Lam","Thanh Lan","Thanh Loan","Thanh Lâm","Thanh Mai","Thanh Mẫn","Thanh Nga","Thanh Nguyên","Thanh Ngân","Thanh Ngọc","Thanh Nhung","Thanh Nhàn","Thanh Nhã","Thanh Phương","Thanh Thanh","Thanh Thiên","Thanh Thu","Thanh Thúy","Thanh Thư","Thanh Thảo","Thanh Thủy","Thanh Trang","Thanh Trúc","Thanh Tuyết","Thanh Tuyền","Thanh Tâm","Thanh Uyên","Thanh Vy","Thanh Vân","Thanh Xuân","Thanh Yến","Thanh Đan","Thi Cầm","Thi Ngôn","Thi Thi","Thi Xuân","Thi Yến","Thiên Di","Thiên Duyên","Thiên Giang","Thiên Hà","Thiên Hương","Thiên Khánh","Thiên Kim","Thiên Lam","Thiên Lan","Thiên Mai","Thiên Mỹ","Thiên Nga","Thiên Nương","Thiên Phương","Thiên Thanh","Thiên Thêu","Thiên Thư","Thiên Thảo","Thiên Trang","Thiên Tuyền","Thiếu Mai","Thiều Ly","Thiện Mỹ","Thiện Tiên","Thu Duyên","Thu Giang","Thu Hiền","Thu Hoài","Thu Huyền","Thu Huệ","Thu Hà","Thu Hậu","Thu Hằng","Thu Hồng","Thu Linh","Thu Liên","Thu Loan","Thu Mai","Thu Minh","Thu Nga","Thu Nguyệt","Thu Ngà","Thu Ngân","Thu Ngọc","Thu Nhiên","Thu Oanh","Thu Phong","Thu Phương","Thu Phượng","Thu Sương","Thu Thuận","Thu Thảo","Thu Thủy","Thu Trang","Thu Việt","Thu Vân","Thu Vọng","Thu Yến","Thuần Hậu","Thy Khanh","Thy Oanh","Thy Trúc","Thy Vân","Thái Chi","Thái Hà","Thái Hồng","Thái Lan","Thái Lâm","Thái Thanh","Thái Thảo","Thái Tâm","Thái Vân","Thùy Anh","Thùy Dung","Thùy Dương","Thùy Giang","Thùy Linh","Thùy Mi","Thùy My","Thùy Nhi","Thùy Như","Thùy Oanh","Thùy Uyên","Thùy Vân","Thúy Anh","Thúy Diễm","Thúy Hiền","Thúy Huyền","Thúy Hà","Thúy Hương","Thúy Hường","Thúy Hạnh","Thúy Hằng","Thúy Kiều","Thúy Liên","Thúy Liễu","Thúy Loan","Thúy Mai","Thúy Minh","Thúy My","Thúy Nga","Thúy Ngà","Thúy Ngân","Thúy Ngọc","Thúy Phượng","Thúy Quỳnh","Thúy Vi","Thúy Vy","Thúy Vân","Thơ Thơ","Thư Lâm","Thư Sương","Thương Huyền","Thương Nga","Thương Thương","Thường Xuân","Thạch Thảo","Thảo Hương","Thảo Hồng","Thảo Linh","Thảo Ly","Thảo Mai","Thảo My","Thảo Nghi","Thảo Nguyên","Thảo Nhi","Thảo Quyên","Thảo Tiên","Thảo Trang","Thảo Uyên","Thảo Vy","Thảo Vân","Thục Anh","Thục Khuê","Thục Nhi","Thục Oanh","Thục Quyên","Thục Trang","Thục Trinh","Thục Tâm","Thục Uyên","Thục Vân","Thục Ðoan","Thục Ðào","Thục Ðình","Thụy Du","Thụy Khanh","Thụy Linh","Thụy Lâm","Thụy Miên","Thụy Nương","Thụy Trinh","Thụy Trâm","Thụy Uyên","Thụy Vân","Thụy Ðào","Thủy Hằng","Thủy Hồng","Thủy Linh","Thủy Minh","Thủy Nguyệt","Thủy Quỳnh","Thủy Tiên","Thủy Trang","Thủy Tâm","Tinh Tú","Tiên Phương","Tiểu Mi","Tiểu My","Tiểu Quỳnh","Trang Anh","Trang Linh","Trang Nhã","Trang Tâm","Trang Ðài","Triều Nguyệt","Triều Thanh","Triệu Mẫn","Trung Anh","Trà Giang","Trà My","Trâm Anh","Trâm Oanh","Trân Châu","Trúc Chi","Trúc Lam","Trúc Lan","Trúc Linh","Trúc Liên","Trúc Loan","Trúc Ly","Trúc Lâm","Trúc Mai","Trúc Phương","Trúc Quân","Trúc Quỳnh","Trúc Vy","Trúc Vân","Trúc Ðào","Trúc Đào","Trầm Hương","Tuyết Anh","Tuyết Băng","Tuyết Chi","Tuyết Hoa","Tuyết Hân","Tuyết Hương","Tuyết Hồng","Tuyết Lan","Tuyết Loan","Tuyết Lâm","Tuyết Mai","Tuyết Nga","Tuyết Nhi","Tuyết Nhung","Tuyết Oanh","Tuyết Thanh","Tuyết Trinh","Tuyết Trầm","Tuyết Tâm","Tuyết Vy","Tuyết Vân","Tuyết Xuân","Tuyền Lâm","Tuệ Lâm","Tuệ Mẫn","Tuệ Nhi","Tâm Hiền","Tâm Hạnh","Tâm Hằng","Tâm Khanh","Tâm Linh","Tâm Nguyên","Tâm Nguyệt","Tâm Nhi","Tâm Như","Tâm Thanh","Tâm Trang","Tâm Ðoan","Tâm Đan","Tùng Linh","Tùng Lâm","Tùng Quân","Tùy Anh","Tùy Linh","Tú Anh","Tú Ly","Tú Nguyệt","Tú Quyên","Tú Quỳnh","Tú Sương","Tú Trinh","Tú Tâm","Tú Uyên","Túy Loan","Tường Chinh","Tường Vi","Tường Vy","Tường Vân","Tịnh Lâm","Tịnh Nhi","Tịnh Như","Tịnh Tâm","Tịnh Yên","Tố Loan","Tố Nga","Tố Nhi","Tố Quyên","Tố Tâm","Tố Uyên","Từ Dung","Từ Ân","Uyên Minh","Uyên My","Uyên Nhi","Uyên Phương","Uyên Thi","Uyên Thy","Uyên Thơ","Uyên Trâm","Uyên Vi","Uyển Khanh","Uyển My","Uyển Nghi","Uyển Nhi","Uyển Nhã","Uyển Như","Vi Quyên","Vinh Diệu","Việt Hà","Việt Hương","Việt Khuê","Việt Mi","Việt Nga","Việt Nhi","Việt Thi","Việt Trinh","Việt Tuyết","Việt Yến","Vy Lam","Vy Lan","Vàng Anh","Vành Khuyên","Vân Anh","Vân Chi","Vân Du","Vân Hà","Vân Hương","Vân Khanh","Vân Khánh","Vân Linh","Vân Ngọc","Vân Nhi","Vân Phi","Vân Phương","Vân Quyên","Vân Quỳnh","Vân Thanh","Vân Thúy","Vân Thường","Vân Tiên","Vân Trang","Vân Trinh","Vũ Hồng","Xuyến Chi","Xuân Bảo","Xuân Dung","Xuân Hiền","Xuân Hoa","Xuân Hân","Xuân Hương","Xuân Hạnh","Xuân Lan","Xuân Linh","Xuân Liễu","Xuân Loan","Xuân Lâm","Xuân Mai","Xuân Nghi","Xuân Ngọc","Xuân Nhi","Xuân Nhiên","Xuân Nương","Xuân Phương","Xuân Phượng","Xuân Thanh","Xuân Thu","Xuân Thảo","Xuân Thủy","Xuân Trang","Xuân Tâm","Xuân Uyên","Xuân Vân","Xuân Yến","Xuân xanh","Yên Bằng","Yên Mai","Yên Nhi","Yên Ðan","Yên Đan","Yến Anh","Yến Hồng","Yến Loan","Yến Mai","Yến My","Yến Nhi","Yến Oanh","Yến Phương","Yến Phượng","Yến Thanh","Yến Thảo","Yến Trang","Yến Trinh","Yến Trâm","Yến Ðan","Ái Hồng","Ái Khanh","Ái Linh","Ái Nhi","Ái Nhân","Ái Thi","Ái Thy","Ái Vân","Ánh Dương","Ánh Hoa","Ánh Hồng","Ánh Linh","Ánh Lệ","Ánh Mai","Ánh Nguyệt","Ánh Ngọc","Ánh Thơ","Ánh Trang","Ánh Tuyết","Ánh Xuân","Ðan Khanh","Ðan Quỳnh","Ðan Thu","Ðinh Hương","Ðoan Thanh","Ðoan Trang","Ðài Trang","Ðông Nghi","Ðông Nhi","Ðông Trà","Ðông Tuyền","Ðông Vy","Ðông Ðào","Ðồng Dao","Ý Bình","Ý Lan","Ý Nhi","Đan Linh","Đan Quỳnh","Đan Thanh","Đan Thu","Đan Thư","Đan Tâm","Đinh Hương","Đoan Thanh","Đoan Trang","Đài Trang","Đông Nghi","Đông Trà","Đông Tuyền","Đông Vy","Đơn Thuần","Đức Hạnh","Ấu Lăng"
    ]);

    const SPECIAL_CHARS = new Set([".", ",", "/", "%", "&", "*", "-", "+"]);

    const detect = (name) => {
        try {
            if (!name || name.trim() === "") return "UNKNOWN";
            if (SPECIAL_CHARS.has(name)) return ['FEMALE', 'MALE'][Math.floor(Math.random() * 2)];
            if (FEMALE_NAMES.has(name)) return "FEMALE";
            const lastWord = name.split(' ').pop();
            if (FEMALE_NAMES.has(lastWord)) return "FEMALE";
            const hasFemalePart = [...FEMALE_NAMES].some(fn => name.includes(fn));
            if (hasFemalePart) return "FEMALE";
            return "MALE";
        } catch (_) {
            return "UNKNOWN";
        }
    };

    return { detect };
})();

function makeDefaults(html, userID, ctx) {
    let reqCounter = 1;
    let fb_dtsg = HTMLProcessor.getFrom(html, 'name="fb_dtsg" value="', '"');
    if (!fb_dtsg) fb_dtsg = (html.match(/"fb_dtsg":"([^"]+)"/) || [])[1] || '';

    let ttstamp = "2";
    for (let i = 0; i < fb_dtsg.length; i++) ttstamp += fb_dtsg.charCodeAt(i);
    const revision = HTMLProcessor.getFrom(html, 'revision":', ",");

    const mergeWithDefaults = (obj) => {
        const base = {
            __user: userID,
            __req: (reqCounter++).toString(36),
            __rev: revision,
            __a: 1,
            fb_dtsg: ctx.fb_dtsg || fb_dtsg,
            jazoest: ctx.ttstamp || ttstamp
        };
        if (!obj) return base;
        for (const prop in obj) {
            if (obj.hasOwnProperty(prop) && !base[prop]) base[prop] = obj[prop];
        }
        return base;
    };

    return {
        get: (url, jar, qs, ctxx) => NetworkClient.get(url, jar, mergeWithDefaults(qs), ctx.globalOptions, ctxx || ctx),
        post: (url, jar, form, ctxx) => NetworkClient.post(url, jar, mergeWithDefaults(form), ctx.globalOptions, ctxx || ctx),
        postFormData: (url, jar, form, qs, ctxx) => NetworkClient.postFormData(url, jar, mergeWithDefaults(form), mergeWithDefaults(qs), ctx.globalOptions, ctxx || ctx)
    };
}

function parseAndCheckLogin(ctx, defaultFuncs, retryCount) {
    if (retryCount === undefined) retryCount = 0;
    return function(data) {
        return bluebird.try(function() {
            if (data.statusCode >= 500 && data.statusCode < 600) {
                if (retryCount >= 5) {
                    throw {
                        error: "Request retry limit reached.",
                        statusCode: data.statusCode,
                        res: data.body
                    };
                }
                retryCount++;
                const retryDelay = Math.floor(Math.random() * 5000) + (retryCount * 1000);
                const url = data.request.uri.protocol + "//" + data.request.uri.hostname + data.request.uri.pathname;
                const isMultipart = data.request.headers["Content-Type"]?.split(";")?.[0] === "multipart/form-data";
                return bluebird.delay(retryDelay).then(() => {
                    return isMultipart
                        ? defaultFuncs.postFormData(url, ctx.jar, data.request.formData, {})
                        : defaultFuncs.post(url, ctx.jar, data.request.formData);
                }).then(parseAndCheckLogin(ctx, defaultFuncs, retryCount));
            }

            if (data.statusCode !== 200) {
                throw new Error(`Unexpected status code: ${data.statusCode}`);
            }

            let res = null;
            try {
                res = JSON.parse(HTMLProcessor.makeParsable(data.body));
            } catch (e) {
                throw { error: "JSON parse failed", detail: e, res: data.body };
            }

            if (res.redirect && data.request.method === "GET") {
                return defaultFuncs.get(res.redirect, ctx.jar).then(parseAndCheckLogin(ctx, defaultFuncs));
            }

            if (res.jsmods?.require && Array.isArray(res.jsmods.require[0]) && res.jsmods.require[0][0] === "Cookie") {
                res.jsmods.require[0][3][0] = res.jsmods.require[0][3][0].replace("_js_", "");
                const cookie = CookieEngine.format(res.jsmods.require[0][3], "facebook");
                const cookie2 = CookieEngine.format(res.jsmods.require[0][3], "messenger");
                ctx.jar.setCookie(cookie, "https://www.facebook.com");
                ctx.jar.setCookie(cookie2, "https://www.messenger.com");
            }

            if (res.jsmods && Array.isArray(res.jsmods.require)) {
                for (const item of res.jsmods.require) {
                    if (item[0] === "DTSG" && item[1] === "setToken") {
                        ctx.fb_dtsg = item[3][0];
                        ctx.ttstamp = "2";
                        for (let j = 0; j < ctx.fb_dtsg.length; j++) ctx.ttstamp += ctx.fb_dtsg.charCodeAt(j);
                    }
                }
            }

            if (res.error === 1357001) throw { error: "Session expired. Not logged in." };
            return res;
        });
    };
}

module.exports = {
    getType,
    isReadableStream,
    cleanHTML: HTMLProcessor.cleanHTML,
    decodeClientPayload: HTMLProcessor.decodeClientPayload,
    makeParsable: HTMLProcessor.makeParsable,
    getFrom: HTMLProcessor.getFrom,

    get: NetworkClient.get,
    post: NetworkClient.post,
    postFormData: NetworkClient.postFormData,
    setProxy: NetworkClient.setProxy,
    getJar: NetworkClient.getJar,

    generateThreadingID: EncodingEngine.generateThreadingID,
    generateOfflineThreadingID: EncodingEngine.generateOfflineThreadingID,
    generatePresence: EncodingEngine.generatePresence,
    generateAccessiblityCookie: EncodingEngine.generateAccessibilityCookie,
    getGUID: EncodingEngine.getGUID,
    getSignatureID: EncodingEngine.getSignatureID,
    generateSessionId: EncodingEngine.generateSessionId,
    generateUuid: EncodingEngine.generateUuid,
    generateRequestId: EncodingEngine.generateRequestId,
    generateHsi: EncodingEngine.generateHsi,
    generateClientMutationId: EncodingEngine.generateClientMutationId,
    generateSerializedState: EncodingEngine.generateSerializedState,
    generateSessionString: EncodingEngine.generateSessionString,
    generateTimestampRelative: TimeUtils.generateTimestampRelative,
    presenceEncode: EncodingEngine.encode,
    presenceDecode: EncodingEngine.decode,

    _formatAttachment: AttachmentProcessor.formatSingle,
    formatAttachment: AttachmentProcessor.format,

    formatID: IDProcessor.format,
    formatMessage: MessageFormatter.formatMessage,
    formatEvent: MessageFormatter.formatEvent,
    formatHistoryMessage: MessageFormatter.formatHistoryMessage,
    formatDeltaMessage: MessageFormatter.formatDeltaMessage,
    formatDeltaEvent: MessageFormatter.formatDeltaEvent,
    formatTyp: MessageFormatter.formatTyp,
    formatReadReceipt: MessageFormatter.formatReadReceipt,
    formatRead: MessageFormatter.formatRead,
    getAdminTextMessageType: MessageFormatter.getAdminTextType,

    formatThread: ThreadFormatter.format,
    formatProxyPresence: PresenceFormatter.formatProxy,
    formatPresence: PresenceFormatter.format,

    formatCookie: CookieEngine.format,
    saveCookies: CookieEngine.save,
    getAppState: CookieEngine.getAppState,

    getData_Path: DataAccessor.get,
    setData_Path: DataAccessor.set,
    getPaths: DataAccessor.paths,

    arrToForm: FormUtils.arrToForm,
    arrayToObject: FormUtils.arrayToObject,
    formatDate: TimeUtils.formatDate,
    padZeros: IDProcessor.padZeros,

    getGender: GenderDetector.detect,
    makeDefaults,
    parseAndCheckLogin,

    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    generateClientMutationID: EncodingEngine.generateClientMutationId
};
