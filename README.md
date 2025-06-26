# Sonic Flow

**Sonic Flow: A Lightweight, AI-Powered Dictation App for macOS**

Sonic Flow is a macOS desktop application designed to transform your voice into text seamlessly. It listens to your speech and inserts the transcribed text directly at your cursor's position in any application. Experience the convenience of hands-free typing with support for both privacy-focused local, on-device transcription and highly accurate cloud-based transcription.

## Features

Sonic Flow offers a range of features to enhance your productivity:

- **Real-time Dictation:** Transcribes your speech into text as you speak. For local transcription, partial results may be displayed in real-time.
- **Dual Transcription Modes:**
  - **Versatile Transcription Modes:** Choose between offline local transcription for privacy and speed, or powerful cloud-based transcription for potentially higher accuracy.
  - **Local Mode:**
    - Utilizes a sophisticated on-device ASR (Automatic Speech Recognition) engine.
    - Employs Web Workers, AudioWorklet, and SharedArrayBuffer technology for efficient, non-blocking audio processing.
    - Provides feedback during initial model download/setup (`Engine loading...`) and when ready for use.
    - Ideal for offline usage and when data privacy is paramount.
  - **Cloud Mode:**
    - Supports multiple leading AI providers: **Groq API** and **Google Gemini API**.
    - Allows users to select their preferred cloud transcription engine through the Settings in the Home window.
    - Requires an active internet connection.
- **Function Key Control:** Toggle dictation on or off from any application using the Function (Fn) key. The app automatically detects Function key presses and provides permission prompts for Input Monitoring access when needed.
- **Minimalist "Pill" UI:** A discreet, always-on-top UI element allows for quick interaction (start/stop dictation) and provides visual feedback on the app's status (idle, listening, processing).
- **Home Window (Dashboard & Settings):** Accessible from the tray icon's context menu, the Home window provides a central hub for insights and customization:
  - **Dashboard Tab:**
    - View key usage statistics, such as 'Total Dictations' and total 'Dictation Time'.
    - Visualize your productivity with a 'Time Saved with Dictation' chart, comparing dictation speed against average typing speed.
    - Displays information related to your subscription plan (e.g., 'Pro Plan' status and benefits – note: some elements may be illustrative of future premium features).
  - **Settings Tab:**
    - _Application Settings:_
      - Toggle 'Launch on startup' to have Sonic Flow start automatically.
      - Select your preferred 'Recognition language' from a list of supported languages (e.g., English US/UK, Spanish, French, German).
    - _Microphone Setup:_
      - Choose your desired audio 'Input device' from available microphones.
      - Adjust 'Input sensitivity' for optimal performance.
  - **Account Tab:**
    - Manage basic profile information (e.g., Display Name, Email). Further account management features are planned.
- **Advanced Automatic Text Insertion:** Transcribed text is automatically pasted at your current cursor location. Sonic Flow uses a robust mechanism that leverages macOS AppleScript commands and intelligently restores your original clipboard content post-insertion. If an Electron window is focused, or if paste fails, text is copied to the clipboard with a notification.
- **Custom System Notifications:** Receive timely feedback through a custom-designed, non-intrusive notification system. Events include: engine loading status (e.g., 'Engine loading...'), errors during operation, and confirmation messages like 'Output copied to clipboard'.
- **Native macOS Tray Integration:**
  - **Convenient Tray Access:**
    - Sonic Flow resides in the macOS system tray for unobtrusive access.
    - A right-click on the tray icon opens a native macOS context menu, providing quick options to:
      - Open the **Home window** (Dashboard & Settings).
      - **Exit** the application.

## Technologies Used

Sonic Flow is built with a modern stack of technologies:

- **Core Framework:** Electron (for macOS desktop application development)
- **Frontend:**
  - React (with TypeScript): For the main user interface components (Pill UI, Home Window).
  - Tailwind CSS: For styling the React components.
  - Framer Motion: For animations within the React components.
  - Custom HTML/CSS/JS: Utilized directly within Electron BrowserWindows for lightweight, dynamic notification pop-ups.
- **Build System:** Vite (for fast development and optimized builds)
- **AI & Transcription Engine:**
  - **Local ASR:**
    - `@huggingface/transformers` (potential library for loading/running local models)
    - ONNX Runtime (`onnxruntime-web`) (for efficient execution of machine learning models)
    - Web Workers (to run ASR in the background without freezing the UI)
    - AudioWorklet API & `SharedArrayBuffer` (for efficient audio capture and processing)
  - **Cloud ASR:**
    - Groq SDK (`groq-sdk`) (for interacting with Groq's transcription API)
    - Google Gemini API (for alternative high-accuracy cloud transcription)
  - **Audio Capture:** WebRTC `MediaRecorder` API (for cloud mode audio capture)
- **Linting:** ESLint with TypeScript support.

## Getting Started / Development

To get Sonic Flow running on your local machine for development:

1.  **Prerequisites:**
    - Node.js (v18.x or later recommended)
    - npm (comes with Node.js) or yarn

2.  **Clone the Repository:**

    ```bash
    git clone https://github.com/your-username/sonic-flow.git # Replace with the actual repository URL
    cd sonic-flow
    ```

3.  **Install Dependencies:**

    ```bash
    npm install
    ```

    (Or if you prefer yarn: `yarn install`)

4.  **Run the Application:**

    ```bash
    npm start
    ```

    This will launch the application in development mode with hot reloading enabled.

5.  **Switching Transcription Modes:**
    - The application allows switching between 'local' and 'cloud' transcription modes. This setting is typically found in the main application window's "Settings" area.
    - **Note for Local Mode:** The first time you switch to or start in local mode, the necessary AI models will be downloaded and initialized. This might take some time. Subsequent starts will be faster.
    - **Note for Cloud Mode:** Ensure you have a working internet connection. Configuration for API keys (e.g., for Groq) might be required (see Configuration section).

## Building the Application

Sonic Flow uses Electron Forge to package and build distributables for macOS.

1.  **Package the Application:**
    - This command bundles your application code.

    ```bash
    npm run package
    ```

2.  **Create Distributables (Make):**
    - This command creates an installable `.zip` package for macOS.
    ```bash
    npm run make
    ```
    The generated installers and packaged application files will be located in the `out` directory.

For more details on build configuration, refer to the `forge.config.ts` file.

## Project Structure

Here's an overview of the key directories and files in Sonic Flow:

```
sonic-flow/
├── .vite/                # Vite's build output and cache
├── out/                  # Output directory for packaged application and installers
├── public/               # Static assets
│   ├── assets/           # Icons, images
│   └── audioworklet-processor.js # Custom AudioWorklet for local audio capture
├── src/                  # Source code
│   ├── audio/            # Audio processing utilities (e.g., ring buffers)
│   ├── components/       # React components
│   │   ├── App.tsx       # Core application component managing the "Pill" UI and dictation state
│   │   └── HomePage.tsx  # UI for the main application window (dashboard, settings)
│   ├── hooks/            # Custom React hooks
│   │   └── useTranscription.ts # Central hook managing transcription logic (local & cloud)
│   ├── lib/              # Utility functions and libraries
│   ├── workers/          # Web Workers
│   │   ├── local-worker.ts # Worker for handling local ASR model loading and transcription
│   │   ├── gemini-transcriber.ts # Worker for handling Gemini cloud transcription via a backend service.
│   │   └── groq-transcriber.ts   # Worker for handling Groq cloud transcription.
│   ├── main.ts           # Electron main process entry point
│   ├── preload.ts        # Electron preload script for IPC and exposing Node.js features securely
│   ├── contextmenu-preload.js # Preload script for the custom tray context menu window.
│   ├── renderer.tsx      # React application entry point for the renderer process
│   └── index.css         # Global styles
├── .eslintrc.json        # ESLint configuration
├── forge.config.ts       # Electron Forge build configuration
├── package.json          # Project metadata, dependencies, and scripts
├── tsconfig.json         # TypeScript compiler configuration
└── vite.config.ts        # Vite base configuration
```

## Configuration

For certain features, like using a self-configured Groq API for cloud-based transcription, you may need to configure API keys. Other cloud services like Google Gemini are accessed via an intermediary backend and do not require direct user API key input in the desktop app.

1.  **Groq API Key:**
    - To use the cloud transcription mode, you'll need an API key from Groq.
    - Create a `.env` file in the root of the project (e.g., copy `.env.example` if provided, or create a new one).
    - Add your Groq API key to the `.env` file like this:
      ```
      GROQ_API_KEY=your_actual_api_key_here
      ```
    - The application uses `dotenv` to load these variables during development. Ensure this file is not committed to version control if it contains sensitive keys. Add `.env` to your `.gitignore` file if it's not already there.

2.  **Google Gemini API:**
    - The Sonic Flow application can also utilize Google Gemini for cloud-based transcription.
    - This integration is facilitated through a backend service hosted at `https://api.sonicflow.app/gemini`.
    - Unlike the Groq API, users of the Sonic Flow desktop application do **not** need to configure a personal Gemini API key directly within the app. The API key management for Gemini is handled by this backend service.
    - To use Gemini transcription, simply select "Gemini" as your cloud engine in the application's settings. Ensure you have an internet connection.

**Note:** The specific environment variable names and requirements might vary. Check the relevant parts of the source code (e.g., where `groq-sdk` is initialized or where `process.env` is accessed) for the exact variable names if you encounter issues.

## Contributing

Contributions to Sonic Flow are welcome! If you'd like to help improve the application, please follow these general guidelines:

1.  **Fork the Repository:** Create your own fork of the main Sonic Flow repository.
2.  **Create a Branch:** Make your changes in a dedicated branch in your forked repository. Name your branch descriptively (e.g., `feature/new-shortcut` or `fix/settings-bug`).
3.  **Make Your Changes:** Implement your feature or bug fix.
4.  **Lint Your Code:** Ensure your code adheres to the project's coding standards by running the linter:
    ```bash
    npm run lint
    ```
    Fix any linting errors or warnings before committing.
5.  **Test Your Changes:** (If applicable) Add unit or integration tests for your changes and ensure all tests pass.
6.  **Commit Your Changes:** Write clear and concise commit messages.
7.  **Submit a Pull Request:** Open a pull request from your branch to the `main` branch (or the relevant development branch) of the original Sonic Flow repository. Provide a clear description of the changes you've made.

We'll review your pull request as soon as possible.

## License

Sonic Flow is currently released under a **Proprietary License**.

For more details, please refer to the `LICENSE` file in the repository (if available) or contact the project author.
