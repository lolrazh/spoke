// a good bulk of this is from https://github.com/xenova/whisper-web/blob/main/src/worker.js
import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  full,
} from '@huggingface/transformers';


const MAX_NEW_TOKENS = 64;

/**
* This class uses the Singleton pattern to ensure that only one instance of the model is loaded.
*/
class AutomaticSpeechRecognitionPipeline {
  static model_id = null;
  static tokenizer = null;
  static processor = null;
  static model = null;

  static async getInstance(progress_callback = null) {
      this.model_id = 'onnx-community/whisper-base';

      this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
          progress_callback,
      });
      this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
          progress_callback,
      });

      this.model ??= WhisperForConditionalGeneration.from_pretrained(this.model_id, {
          dtype: {
              encoder_model: 'fp32', // 'fp16' works too
              decoder_model_merged: 'q4', // or 'fp32' ('fp16' is broken)
          },
          device: 'webgpu',
          progress_callback,
      });

      return Promise.all([this.tokenizer, this.processor, this.model]);
  }
}

let processing = false;
async function generate({ audio, language }) {
  if (processing) return;
  processing = true;

  // Tell the main thread we are starting
  self.postMessage({ status: 'start' });

  // Retrieve the text-generation pipeline.
  const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance();

  const inputs = await processor(audio);

  const outputs = await model.generate({
      ...inputs,
      max_new_tokens: MAX_NEW_TOKENS,
      language,
  });

  const outputText = tokenizer.batch_decode(outputs, { skip_special_tokens: true });

  // Send the output back to the main thread
  self.postMessage({
      status: 'complete',
      output: outputText,
  });
  processing = false;
}

async function load() {
  self.postMessage({
      status: 'loading',
      data: 'Loading model...'
  });

  // Load the pipeline and save it for future use.
  const [model] = await AutomaticSpeechRecognitionPipeline.getInstance(x => {
      // We also add a progress callback to the pipeline so that we can
      // track model loading.
      self.postMessage(x);
  });

  self.postMessage({
      status: 'loading',
      data: 'Compiling shaders and warming up model...'
  });

  self.postMessage({ status: 'ready' });
}
// Listen for messages from the main thread
self.addEventListener('message', async (e) => {
  const { type, data } = e.data;

  switch (type) {
      case 'load':
          load();
          break;

      case 'generate':
          generate(data);
          break;
  }
});