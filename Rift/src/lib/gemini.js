import { GoogleGenAI } from '@google/genai';

function getAI() {
    let keyString = localStorage.getItem('rift_api_key');
    if (!keyString && import.meta.env.VITE_GEMINI_API_KEY && import.meta.env.VITE_GEMINI_API_KEY !== 'YOUR_API_KEY_HERE') {
        keyString = import.meta.env.VITE_GEMINI_API_KEY;
    }
    if (keyString) {
        return new GoogleGenAI({ apiKey: keyString });
    }
    return null;
}

export async function parseIncidentPayload(payload, liveNodes = []) {
    const defaultNodeId = liveNodes.length > 0 ? liveNodes[0].id : 'lb-1';

    const ai = getAI();

    if (!ai) {
        window.dispatchEvent(new Event('trigger-api-key-modal'));
        return { target: defaultNodeId, type: 'Unclassified HTTP Vector (API Key Missing)' };
    }

    const availableNodesString = liveNodes.map(n => `- "${n.id}" (${n.data?.label} / ${n.data?.type})`).join('\n');

    try {
        let contentsData;
        
        if (payload.type === 'image') {
           contentsData = [
               { text: `You are an AI Intake Router. Look at this uploaded image. It is a screenshot of an error, graph, or architecture issue. Explicitly determine which architectural node is failing or under attack.
You can ONLY choose from these LIVE Node IDs currently in the user's infrastructure:
${availableNodesString}

Return ONLY a raw, perfectly formatted JSON object with no markdown wrappers containing:
{ "target": "node-id-here", "type": "A specific 2-4 word description of the issue seen in the image", "chat_response": "A highly conversational, slightly cyber-themed 1-2 sentence response speaking directly to the user addressing the incident." }` },
               { inlineData: { mimeType: payload.mimeType, data: payload.content } }
           ];
        } else if (payload.type === 'audio') {
           contentsData = [
               { text: `You are an autonomous AI cyber-commander. Listen strictly to the user's audio command or threat dictation. You must explicitly determine which architectural node they are targeting.
You can ONLY choose from these LIVE Node IDs currently in the user's infrastructure:
${availableNodesString}

Return ONLY a raw, perfectly formatted JSON object with no markdown wrappers containing:
{ "target": "node-id-here", "type": "A specific 2-4 word description derived from their voice command", "chat_response": "A highly conversational, slightly cyber-themed 1-2 sentence response speaking directly to the user addressing their voice command directly." }` },
               { inlineData: { mimeType: payload.mimeType, data: payload.content } }
           ];
        } else {
           contentsData = `You are an AI Intake Router for an enterprise cybersecurity platform. 
The user has submitted this raw data (which could be plain english, a log, file content, or a JSON trace):
"${payload.content}"

Based on the text, explicitly determine which architectural node is the likely target. 
You can ONLY choose from these LIVE Node IDs currently in the user's infrastructure:
${availableNodesString}

Return ONLY a raw, perfectly formatted JSON object with no markdown wrappers containing:
{ "target": "node-id-here", "type": "A very short, 2-to-4 word description of what the attack/error appears to be", "chat_response": "A highly conversational, slightly cyber-themed 1-2 sentence response speaking directly to the user addressing their text ingestion." }`;
        }

        const response = await ai.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: contentsData,
        });
        
        let text = response.text || '';
        const match = text.match(/\{.*?\}/s);
        if (match) {
            return JSON.parse(match[0]);
        }
        return JSON.parse(text);
    } catch(e) {
        console.error("Gemini API Error:", e);
        if (e.message && (e.message.includes('429') || e.message.toLowerCase().includes('quota'))) {
            return { target: defaultNodeId, type: 'API Quota Exhausted', chat_response: 'It seems our communication uplink is temporarily overloaded by API quota exhaustion. Please standby or rotate your security key.' };
        }
        window.dispatchEvent(new Event('trigger-api-key-modal'));
        return { target: defaultNodeId, type: 'Unclassified Intake Overload', chat_response: 'I encountered an unclassified telemetry disruption.' };
    }
}

export async function handleGeneralChat(payload, liveNodes = []) {
    const ai = getAI();
    if (!ai) {
        window.dispatchEvent(new Event('trigger-api-key-modal'));
        return "I am currently disconnected. Please configure an API Key so we can communicate.";
    }

    const availableNodesString = liveNodes.map(n => `- "${n.id}" (${n.data?.label} / ${n.data?.type})`).join('\n');

    try {
        let contentsData;
        if (payload.type === 'audio') {
            contentsData = [
                { text: `You are AEGIS, a voice-activated AI assistant embedded in the RIFT network observability platform. Listen to the user's audio and respond helpfully. Here is the current live architecture context: \n${availableNodesString}\n\nRespond directly in 1-3 concise spoken sentences. No JSON. No markdown. Pure conversational text. Never refer to yourself as JARVIS.` },
                { inlineData: { mimeType: payload.mimeType, data: payload.content } }
            ];
        } else {
            contentsData = `You are RIFT AI Assist, a helpful text-based assistant embedded in the RIFT network observability platform. The user says: "${payload.content}". Here is the current architecture context: \n${availableNodesString}\n\nRespond concisely and helpfully in 1-3 sentences. Never refer to yourself as JARVIS.`;
        }

        const response = await ai.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: contentsData,
        });
        
        return response.text || "No response generated.";
    } catch(e) {
        console.error("Gemini Chat API Error:", e);
        if (e.message && (e.message.includes('429') || e.message.toLowerCase().includes('quota'))) {
            return "My voice protocol is temporarily overloaded by API quota constraints. Please standby.";
        }
        return "Excuse me, I'm encountering a systemic communication error.";
    }
}

export async function generateAgentResolution(nodeName, attackType) {
    const ai = getAI();
    if (!ai) {
        window.dispatchEvent(new Event('trigger-api-key-modal'));
        return "Deterministic fallback activated: Please configure your API Key.";
    }
    
    try {
        const response = await ai.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: `Write a hyper-realistic, 1-2 sentence DevSecOps incident resolution. The target node was '${nodeName}' and they were hit with '${attackType}'. Mention a specific engineering action taken to patch or block this specific type of attack (e.g., ip-tables, WAF rule, rotating keys, query sanitization). Be extremely technical and terse. Output the resolution action only.`,
        });
        return response.text;
    } catch(e) {
        if (e.message && (e.message.includes('429') || e.message.toLowerCase().includes('quota'))) {
            return "DevSecOps Auto-Resolution suppressed: API Quota exhausted.";
        }
        window.dispatchEvent(new Event('trigger-api-key-modal'));
        return "DevSecOps AI Generation failed. API Key error or infrastructure overload.";
    }
}

export async function requestAntibodyPath(anomalies) {
    // Return a dummy strike coordinate for the matrix renderer
    return { strikeX: 128, strikeY: 128 };
}
