"""
Travel Agent Backend with Ollama LLM Integration
Handles conversation with landmark extraction and coordination
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import re
from openai import OpenAI

app = FastAPI(title="Travel Agent API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Ollama client (using OpenAI-compatible API)
ollama_client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama"  # Ollama doesn't need a real key
)

# Load landmarks database
with open("landmarks_db.json", "r") as f:
    LANDMARKS_DB = json.load(f)


class Message(BaseModel):
    role: str
    content: str


class ConversationRequest(BaseModel):
    messages: List[Message]
    location: Optional[str] = None


class LandmarkMention(BaseModel):
    landmark_id: str
    name: str
    coordinates: List[float]
    timing: float  # When in the response this should be highlighted
    zoom: int
    description: str
    highlights: List[str]
    imageUrl: str


class ConversationResponse(BaseModel):
    text: str
    landmarks: List[LandmarkMention]
    city_info: Optional[Dict]


def extract_landmarks_from_text(text: str, location: str = "tunis") -> List[Dict]:
    """
    Extract landmark mentions from the generated text.
    Returns landmarks with approximate timing based on text position.
    """
    landmarks_mentioned = []
    
    if location.lower() not in LANDMARKS_DB:
        return []
    
    location_data = LANDMARKS_DB[location.lower()]
    text_lower = text.lower()
    
    # Calculate approximate timing for each landmark mention
    for landmark in location_data["landmarks"]:
        for keyword in landmark["keywords"]:
            # Find all occurrences of the keyword
            pattern = r'\b' + re.escape(keyword) + r'\b'
            matches = re.finditer(pattern, text_lower)
            
            for match in matches:
                # Calculate timing as percentage through the text
                position = match.start()
                timing_percentage = position / len(text) if len(text) > 0 else 0
                
                landmarks_mentioned.append({
                    "landmark_id": landmark["id"],
                    "name": landmark["name"],
                    "coordinates": landmark["coordinates"],
                    "timing": timing_percentage,  # 0.0 to 1.0
                    "zoom": landmark["zoom"],
                    "type": landmark["type"],
                    "description": landmark["description"],
                    "highlights": landmark["highlights"],
                    "imageUrl": landmark["imageUrl"],
                    "matched_keyword": keyword,
                    "position": position
                })
                break  # Only match once per landmark
    
    # Sort by timing (order they appear in text)
    landmarks_mentioned.sort(key=lambda x: x["timing"])
    
    return landmarks_mentioned


def build_travel_agent_prompt(location: str) -> str:
    """
    Build a specialized prompt for the travel agent persona.
    Includes information about available landmarks to mention.
    """
    
    if location.lower() not in LANDMARKS_DB:
        location_info = "I don't have detailed information about this location."
        landmarks_list = []
    else:
        location_data = LANDMARKS_DB[location.lower()]
        city = location_data["city"]
        landmarks = location_data["landmarks"]
        
        location_info = f"{city['name']}: {city['description']}"
        landmarks_list = [f"- {lm['name']}: {lm['description']}" for lm in landmarks]
    
    prompt = f"""You are Sofia, an enthusiastic and knowledgeable travel agent who specializes in Mediterranean destinations. You're warm, personable, and love sharing fascinating details about places.

CURRENT LOCATION CONTEXT:
{location_info}

LANDMARKS YOU SHOULD MENTION (when relevant):
{chr(10).join(landmarks_list)}

SPEAKING STYLE:
- Your responses will be spoken aloud, so write in natural, conversational language
- Keep responses concise (2-4 sentences at a time) to maintain engagement
- Mention specific landmarks by name clearly so they can be highlighted visually
- Be enthusiastic but not overwhelming
- Add personal touches like "You'll love..." or "One of my favorite spots is..."
- Use natural pauses with "..." when appropriate

IMPORTANT:
- When mentioning landmarks, use their FULL names clearly (e.g., "Medina of Tunis", "ancient ruins of Carthage")
- Describe them vividly to paint a picture
- Give context (historical dates, significance, what makes them special)
- Suggest what visitors can see or do there

Remember: As you speak about each landmark, it will be highlighted on a map, so mention them in a logical geographic or thematic order when possible."""

    return prompt


@app.post("/api/travel-agent", response_model=ConversationResponse)
async def travel_agent_conversation(request: ConversationRequest):
    """
    Handle conversation with the travel agent.
    Generates response using Ollama and extracts landmark mentions for UI coordination.
    """
    try:
        # Detect location from conversation if not provided
        location = request.location or "tunis"
        
        # Build system prompt with location context
        system_prompt = build_travel_agent_prompt(location)
        
        # Prepare messages for LLM
        messages = [
            {"role": "system", "content": system_prompt}
        ]
        
        # Add conversation history
        for msg in request.messages:
            messages.append({
                "role": msg.role,
                "content": msg.content
            })
        
        # Call Ollama (using Llama 3.2 or 3.3)
        response = ollama_client.chat.completions.create(
            model="llama3.2",  # or "llama3.3:70b" for better quality
            messages=messages,
            temperature=0.7,
            max_tokens=300,  # Keep responses concise for voice
            stream=False
        )
        
        # Extract response text
        response_text = response.choices[0].message.content
        
        # Extract landmarks mentioned in the response
        landmarks = extract_landmarks_from_text(response_text, location)
        
        # Get city info if available
        city_info = None
        if location.lower() in LANDMARKS_DB:
            city_info = LANDMARKS_DB[location.lower()]["city"]
        
        return ConversationResponse(
            text=response_text,
            landmarks=landmarks,
            city_info=city_info
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating response: {str(e)}")


@app.get("/api/locations")
async def get_available_locations():
    """Get list of available locations in the database."""
    return {
        "locations": list(LANDMARKS_DB.keys()),
        "details": {
            key: LANDMARKS_DB[key]["city"] 
            for key in LANDMARKS_DB.keys()
        }
    }


@app.get("/api/landmarks/{location}")
async def get_landmarks(location: str):
    """Get all landmarks for a specific location."""
    if location.lower() not in LANDMARKS_DB:
        raise HTTPException(status_code=404, detail="Location not found")
    
    return LANDMARKS_DB[location.lower()]


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "llm": "ollama"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
