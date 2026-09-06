# Getting & Connecting a Model

CodeAlloy runs open-weights coding models completely locally with **built-in llama.cpp and Apple Silicon Metal GPU acceleration**—no third-party apps, subscription fees, or cloud dependencies required.

---

### Option 1: 1-Click Curated Models (Zero Setup)
CodeAlloy comes with pre-configured, tested coding models optimized for Apple Silicon and x86 hardware:

- **Qwen 2.5 Coder 7B (Recommended)** — State-of-the-art coding model with exceptional reasoning, refactoring, and multi-turn autonomous tool use (16GB+ RAM).
- **Qwen 2.5 Coder 1.5B (Fast & Lightweight)** — Ultra-fast, responsive model ideal for 8GB RAM laptops and instant completions.
- **DeepSeek R1 Distill 7B** — Advanced reasoning model for complex architectural problem-solving.
- **Qwen 2.5 Coder 14B** — High-capability powerhouse for 32GB+ RAM workstations.

Click **Select or Download Model** below to choose and download any model with a single click. CodeAlloy handles the download, quantization setup, and launches the native inference engine automatically.

---

### Option 2: Bring Your Own GGUF File
Already have `.gguf` models downloaded from Hugging Face?
Click **Add Model from Disk** to select any GGUF file from your computer. CodeAlloy will register and serve it immediately.

---

### Option 3: External Ollama or vLLM (Optional)
If you already run external inference servers, CodeAlloy works with them seamlessly:
- **Ollama**: Automatically auto-detected on `http://localhost:11434`.
- **vLLM / LM Studio / Remote GPUs**: Switch provider and configure your endpoint URL via **Configure Custom Endpoint**.

---

[Select or Download Model](command:codealloy.selectModel)
[Add GGUF Model from Disk](command:codealloy.addLocalModel)
[Open Forge Agent](command:codealloy.focusChat)
