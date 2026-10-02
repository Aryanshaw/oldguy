// Reads 16-bit PCM WAV files and pads silence at both ends so joins between chapters do not click.

const BYTES_PER_SAMPLE = 2;

// Reads the "fmt " chunk body and refuses anything that is not plain 16-bit PCM.
function readFormat(buf, at, size) {
  if (size < 16 || at + 16 > buf.length) throw new Error('wav: "fmt " chunk is too short');
  const tag = buf.readUInt16LE(at);
  const channels = buf.readUInt16LE(at + 2);
  const sampleRate = buf.readUInt32LE(at + 4);
  const bitsPerSample = buf.readUInt16LE(at + 14);
  if (tag !== 1) throw new Error(`wav: unsupported format ${tag} (only plain PCM, format 1, is supported)`);
  if (bitsPerSample !== 16) throw new Error(`wav: unsupported ${bitsPerSample}-bit audio (only 16-bit is supported)`);
  if (channels === 0) throw new Error('wav: file declares zero channels');
  if (sampleRate === 0) throw new Error('wav: file declares zero sample rate');
  return { channels, sampleRate, bitsPerSample };
}

// Walks the chunks by id and size (skipping LIST and unknown ones) to find the format and the audio data.
function parseWav(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('wav: not a RIFF/WAVE file (missing or truncated header)');
  }
  let format = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      format = readFormat(buf, body, size);
    } else if (id === 'data') {
      if (!format) throw new Error('wav: data chunk comes before the "fmt " chunk');
      return describeData(buf, format, body, size);
    }
    // chunks are padded to an even length, so step over the pad byte too
    pos = body + size + (size % 2);
  }
  throw new Error(format ? 'wav: no data chunk found (file may be truncated)' : 'wav: no "fmt " chunk found (file may be truncated)');
}

// Checks the data chunk fits in the file and works out its length in seconds.
function describeData(buf, format, dataOffset, dataLength) {
  if (dataOffset + dataLength > buf.length) throw new Error('wav: data chunk claims more audio than the file holds');
  const frameBytes = format.channels * BYTES_PER_SAMPLE;
  if (dataLength % frameBytes !== 0) throw new Error('wav: data chunk is not a whole number of sample frames');
  return { format, dataOffset, dataLength, durationS: dataLength / frameBytes / format.sampleRate };
}

// Returns a copy of the WAV with leadMs of silence before the audio and tailMs after it, with sizes rewritten.
function padWav(buf, { leadMs = 0, tailMs = 0 } = {}) {
  const { format, dataOffset, dataLength } = parseWav(buf);
  const frameBytes = format.channels * BYTES_PER_SAMPLE;
  const silence = (ms) => Buffer.alloc(Math.round((format.sampleRate * ms) / 1000) * frameBytes);
  const lead = silence(leadMs);
  const tail = silence(tailMs);
  const newDataLength = lead.length + dataLength + tail.length;
  const out = Buffer.concat([
    buf.subarray(0, dataOffset),
    lead,
    buf.subarray(dataOffset, dataOffset + dataLength),
    tail,
    buf.subarray(dataOffset + dataLength),
  ]);
  // the data chunk size sits just before the audio; the RIFF size covers everything after its own 8 bytes
  out.writeUInt32LE(newDataLength, dataOffset - 4);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

module.exports = { parseWav, padWav };
