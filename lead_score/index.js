require("dotenv").config();
const axios = require("axios");

const CLIQ_BOT_API_URL = "https://cliq.zoho.com/company/872481709/api/v2/bots/alertbot/message";
const CRM_API_URL = process.env.CRM_API_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const CLIQ_WEBHOOK_TOKEN = process.env.CLIQ_WEBHOOK;
const MAX_RETRIES = 5;
const RATE_LIMIT_DELAY = 1000;

// Refresh Access Token
async function refreshAccessToken(retryCount = 0) {
    try {
        const response = await axios.post("https://accounts.zoho.com/oauth/v2/token", null, {
            params: {
                client_id: CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                refresh_token: process.env.REFRESH_TOKEN,
                grant_type: "refresh_token",
            },
        });
        console.log("Access token refreshed successfully.");
        return response.data.access_token;
    } catch (error) {
        const status = error.response?.status || error.code;

        if ((status === 429 || status === "ENOTFOUND") && retryCount < MAX_RETRIES) {
            console.log(`Retrying token refresh (Attempt ${retryCount + 1})...`);
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * Math.pow(2, retryCount), 30000)));
            return refreshAccessToken(retryCount + 1);
        }

        console.error("Error refreshing access token:", error.response?.data || error.message);
        throw error;
    }
}

// Fetch Leads from CRM
async function fetchLeads(accessToken) {
    let page = 1;
    let hasMoreRecords = true;
    const allLeads = [];

    while (hasMoreRecords) {
        try {
            const response = await axios.get(`${CRM_API_URL}/Leads`, {
                params: { per_page: 200, page },
                headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
            });

            const { data, info } = response.data;
            allLeads.push(...data);
            hasMoreRecords = info.more_records;
            page++;
        } catch (error) {
            if (error.response?.status === 429) {
                console.log("Rate limit exceeded. Retrying...");
                await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
            } else {
                console.error("Error fetching leads:", error.message);
                break;
            }
        }
    }

    console.log(`Fetched ${allLeads.length} leads.`);
    return allLeads;
}

// Update Lead
async function updateLead(accessToken, leadId, newScore) {
    try {
        const response = await axios.put(
            `${CRM_API_URL}/Leads/${leadId}`,
            { data: [{ User_score: newScore }] },
            { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
        );
        console.log(`Updated lead ${leadId} with new score: ${newScore}`);
        return response.data;
    } catch (error) {
        console.error(`Error updating lead ${leadId}:`, error.response?.data || error.message);
    }
}

// Calculate Score for Leads
function calculateScore(lead) {
    let score = 0;

    if (lead.Priority_level === "High") score += 60;
    else if (lead.Priority_level === "Medium") score += 30;
    else score += 10;

    if (lead.Industry === "Large Enterprise") score += 50;
    else if (lead.Industry === "Small/Medium Enterprise") score += 20;

    return score;
}

// Send High Priority Leads to Cliq Bot
async function sendLeadsToCliqBot(leads) {
    const highPriorityLeads = leads.filter((lead) => lead.User_score > 80);

    if (highPriorityLeads.length === 0) {
        console.log("No high-priority leads to send.");
        return;
    }

    const formattedMessage = highPriorityLeads
        .map(
            (lead) =>
                `**Lead Name**: ${lead.Full_Name || "N/A"}\n**Priority**: High\n**User Score**: ${lead.User_score || 0}\n**Industry**: ${lead.Industry || "N/A"}\n**Contact**: ${lead.Email || "N/A"}`
        )
        .join("\n\n");

    try {
        const response = await axios.post(
            `${CLIQ_BOT_API_URL}?zapikey=${CLIQ_WEBHOOK_TOKEN}`,
            { text: `**High Priority Leads Alert**\n\n${formattedMessage}` },
            { headers: { "Content-Type": "application/json" } }
        );
        console.log("Message sent to Cliq bot successfully:", response.data);
    } catch (error) {
        console.error("Error sending leads to Cliq Bot:", error.response?.data || error.message);
    }
}

// Main Function to Process Leads
async function processLeads() {
    try {
        const accessToken = await refreshAccessToken();
        const leads = await fetchLeads(accessToken);

        for (const lead of leads) {
            const newScore = calculateScore(lead);
            lead.User_score = newScore;
            await updateLead(accessToken, lead.id, newScore);
        }

        await sendLeadsToCliqBot(leads);
    } catch (error) {
        console.error("Error processing leads:", error.message);
    }
}

// Run the Process
processLeads();