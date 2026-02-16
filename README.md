# Telegram AI User-Bot

Professional AI User-Bot for Telegram with Uzbek language support and sales capabilities.

## Setup

1.  **Prerequisites**:
    *   Node.js & npm
    *   MongoDB (running on localhost:27017)
    *   Ollama (running on localhost:11434) with `llama3` model (`ollama pull llama3`)

2.  **Configuration**:
    *   Open `.env` file.
    *   Fill in `API_ID` and `API_HASH` (Get these from [https://my.telegram.org](https://my.telegram.org)).
    *   Update `ADMIN_PHONE` if needed.

3.  **To Start**:
    Run the following command in your terminal:
    ```bash
    npm install
    npx ts-node src/index.ts
    ```

4.  **First Run**:
    *   You will be asked to log in with your Telegram Phone Number.
    *   Enter the code sent to your Telegram account.
    *   Once connected, the bot will print a **Session String**.
    *   (Optional) Copy this string to your `.env` file as `SESSION_STRING` to skip login next time.

## Features
*   **AI Sales Agent**: Responds to private messages in Uzbek.
*   **Admin Handoff**: Keywords like "admin", "bog'lanish" trigger admin contact and block the user for 48h.
*   **Ollama Integration**: Uses local LLM for privacy and cost-efficiency.
