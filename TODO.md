- Implement Silero VAD. So by implementing Silero VAD what we can do is after about 10 seconds of dictation we can detect silence, and then split the chunk of audio over there (at the silence), so our text diffs our cleaner. The buffer can keep growing until then. So we need to also remove the hard-coded 10 second buffer length here.

- Implement Beam Search with maybe 3 or 4 outputs and a temperature of 0.3. Test patience values as well (0.5, 1.5 etc.).

- Extract n_best hypotheses. Maybe `num_return_sequences`=4

- Implement Logits Processor for a custom dictionary logic.

- Explore possible pre-processing techniques that significantly improve WER.