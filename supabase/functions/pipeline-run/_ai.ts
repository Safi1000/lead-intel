/** OpenAI Structured Outputs scoring for a sourced place.
 *  Returns pain_points, quality_score (1-10), low_fit, personalization_notes.
 *  Uses response_format: json_schema with strict:true so the schema is enforced
 *  at the grammar level — malformed JSON / missing fields are impossible.
 */

export interface AiScore {
  pain_points: string
  quality_score: number
  low_fit: boolean
  personalization_notes: string
}

export interface PlaceForScoring {
  name: string
  address: string
  phone: string | null
  website: string | null
  rating: number | null
  reviews: Array<{ text: string; rating: number }>
  email: string | null
}

const OPENAI_API_BASE = 'https://api.openai.com/v1'

const OUTPUT_SCHEMA = {
  name: 'lead_score',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      pain_points: {
        type: 'string',
        description: 'Summary of issues or complaints inferred from reviews. MUST be "insufficient data" if reviews are thin.',
      },
      quality_score: {
        type: 'integer',
        description: 'ICP fit score from 1 (worst fit) to 10 (best fit).',
      },
      low_fit: {
        type: 'boolean',
        description: 'True if quality_score is below the configured threshold.',
      },
      personalization_notes: {
        type: 'string',
        description: 'One or two short hooks for cold outreach, grounded in real data about this business.',
      },
    },
    required: ['pain_points', 'quality_score', 'low_fit', 'personalization_notes'],
    additionalProperties: false,
  },
}

function buildPrompt(place: PlaceForScoring, icpRubric: string, qualityThreshold: number): string {
  const reviewCount = place.reviews.length
  const reviewText = place.reviews.map((r) => `[${r.rating}★] ${r.text}`).join('\n')
  const totalChars = reviewText.length

  const reviewSection = reviewCount > 0
    ? `Reviews (${reviewCount} total):\n${reviewText}`
    : 'Reviews: none available.'

  return `You are scoring a business lead for ICP fit and cold outreach personalisation.

ICP RUBRIC (use this to score quality_score 1-10):
${icpRubric || 'No rubric set — use general B2B sales fit criteria.'}

BUSINESS:
Name: ${place.name}
Address: ${place.address}
Phone: ${place.phone ?? 'N/A'}
Website: ${place.website ?? 'N/A'}
Google Rating: ${place.rating ?? 'N/A'}
Email found: ${place.email ?? 'none'}

${reviewSection}

SCORING RULES — follow these exactly:
1. pain_points: Summarise real complaints/issues from reviews. If there are fewer than 3 reviews OR the total review text is under 200 characters, you MUST set pain_points to exactly "insufficient data" — do NOT invent plausible-sounding pain points from thin or missing data.
2. quality_score: Integer 1-10 based on how well this business matches the ICP rubric. 10 = perfect fit.
3. low_fit: Set to true if quality_score is strictly less than ${qualityThreshold}. Otherwise false.
4. personalization_notes: Write 1-2 short, specific hooks usable in a cold email. Base them ONLY on what you can actually see in the reviews, website, or business info above. Do not fabricate specifics.

Respond with valid JSON matching the schema exactly.`
}

export async function scorePlace(
  place: PlaceForScoring,
  icpRubric: string,
  qualityThreshold: number,
  model: string,
  apiKey: string,
): Promise<{ score: AiScore; raw: unknown }> {
  const prompt = buildPrompt(place, icpRubric, qualityThreshold)

  const body = {
    model,
    messages: [{ role: 'user' as const, content: prompt }],
    response_format: { type: 'json_schema', json_schema: OUTPUT_SCHEMA },
    max_tokens: 512,
    temperature: 0.2,
  }

  const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI ${res.status}: ${text}`)
  }

  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const score: AiScore = JSON.parse(content)

  // Sanity-check the score bounds (Structured Outputs guarantees schema but not value ranges)
  score.quality_score = Math.max(1, Math.min(10, Math.round(score.quality_score)))
  score.low_fit = score.quality_score < qualityThreshold

  return { score, raw: data }
}
