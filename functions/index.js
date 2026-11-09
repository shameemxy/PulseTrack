const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ---------------------------------------------------------------------------
// GEMINI API CONFIGURATION
// The API key is stored as a Cloud Function environment variable and is NEVER
// exposed to the client. Set it once via:
//   firebase functions:secrets:set GEMINI_API_KEY
// or for Gen1 style:
//   firebase functions:config:set gemini.key="YOUR_KEY"
// ---------------------------------------------------------------------------
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const emergencySafetySettings = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
];

/**
 * Core triage analysis function.
 * Calls Gemini with a strict JSON schema response and writes results back
 * to the incidents_private document.
 *
 * @param {string} incidentId - The Firestore document ID (Firebase Auth UID)
 */
async function runTriageAnalysis(incidentId) {
  try {
    // Fetch private data (transcript, media) and public data (telemetry) in parallel
    const [privateDoc, publicDoc] = await Promise.all([
      db.collection("incidents_private").doc(incidentId).get(),
      db.collection("incidents_public").doc(incidentId).get(),
    ]);

    if (!privateDoc.exists || !publicDoc.exists) {
      console.warn(`[Triage ${incidentId}] Missing document — skipping.`);
      return;
    }

    const privateData = privateDoc.data();
    const publicData = publicDoc.data();

    // Skip if already assessed
    if (privateData.aiTriage && privateData.aiTriage !== "Pending...") {
      console.log(`[Triage ${incidentId}] Already assessed — skipping.`);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[Triage] GEMINI_API_KEY environment variable is not set.");
      await db.collection("incidents_private").doc(incidentId).update({
        aiTriage: "AI Offline: API key not configured.",
        priorityLevel: 8,
      });
      return;
    }

    // Build the prompt — structured JSON output via responseMimeType
    const prompt = `You are an elite disaster command AI performing an emergency triage assessment.

INCIDENT TELEMETRY:
- Trigger Reason: ${publicData.triggerReason || "Unknown"}
- Motion Peak: ${publicData.motionMS2 || 0} m/s²
- Audio Peak: ${publicData.audioDB || 0} dB
- Battery: ${publicData.battery || "Unknown"}%
- Voice Transcript: "${privateData.transcript || "No words captured."}"
- Packet Type: ${publicData.packetType || "Unknown"}

Based on this telemetry, provide a triage assessment. The priorityLevel must be a number from 1 to 10, where 10 is the most critical requiring immediate extraction.

Respond ONLY with valid JSON in this exact format:
{
  "assessment": "A concise 1-2 sentence emergency assessment describing the likely situation and recommended immediate action.",
  "priorityLevel": <integer 1-10>
}`;

    const parts = [{ text: prompt }];

    // If a photo URL is available, include it via a fetch → inline_data approach
    // Note: Gemini can process images from URLs using fileData in some configs,
    // but for universal compatibility we pass the URL in the text prompt instead.
    if (privateData.photoUrl) {
      parts[0].text += `\n\nNote: An incident photo is available at: ${privateData.photoUrl} — factor visual context into assessment if applicable.`;
    }

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        safetySettings: emergencySafetySettings,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 300,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error("Empty response from Gemini API");
    }

    // Parse the strict JSON response
    let assessment = "Assessment unavailable.";
    let priorityLevel = 5;

    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed.assessment === "string") assessment = parsed.assessment;
      if (typeof parsed.priorityLevel === "number") {
        priorityLevel = Math.min(10, Math.max(1, Math.round(parsed.priorityLevel)));
      }
    } catch (parseErr) {
      console.error(`[Triage ${incidentId}] JSON parse failed:`, parseErr, "Raw:", rawText);
      // Graceful degradation: use the raw text as assessment
      assessment = rawText.slice(0, 300);
    }

    // Write the structured result back to incidents_private
    await db.collection("incidents_private").doc(incidentId).update({
      aiTriage: assessment,
      priorityLevel: priorityLevel,
    });

    console.log(`[Triage ${incidentId}] Complete — Priority ${priorityLevel}/10`);

  } catch (err) {
    console.error(`[Triage ${incidentId}] Failed:`, err);
    // Write a safe fallback so the UI doesn't hang on "Pending..."
    await db.collection("incidents_private").doc(incidentId).update({
      aiTriage: "AI assessment temporarily unavailable. Manual review required.",
      priorityLevel: 7,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// TRIGGER 1: New incident created in incidents_private
// Fires when a victim first submits an SOS
// ---------------------------------------------------------------------------
exports.triageOnCreate = onDocumentCreated(
  "incidents_private/{incidentId}",
  async (event) => {
    const incidentId = event.params.incidentId;
    console.log(`[Triage] New incident created: ${incidentId}`);
    await runTriageAnalysis(incidentId);
  }
);

// ---------------------------------------------------------------------------
// TRIGGER 2: Incident updated in incidents_private
// Fires when aiTriage is reset to "Pending..." (e.g. for re-assessment)
// ---------------------------------------------------------------------------
exports.triageOnUpdate = onDocumentUpdated(
  "incidents_private/{incidentId}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Only re-run if aiTriage was reset to Pending (avoid infinite loops)
    if (after.aiTriage === "Pending..." && before.aiTriage !== "Pending...") {
      const incidentId = event.params.incidentId;
      console.log(`[Triage] Re-assessment triggered for: ${incidentId}`);
      await runTriageAnalysis(incidentId);
    }
  }
);
