
const axios = require('axios');
const stream = require('stream');
const { promisify } = require('util');

const getStreamFromURL = async (url) => {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);
  const readable = new stream.Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
};

module.exports = {
  getStreamFromURL
};
