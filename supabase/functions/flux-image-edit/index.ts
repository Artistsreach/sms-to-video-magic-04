import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FluxRequest {
  prompt: string
  input_image: string
  aspect_ratio?: string
  seed?: number
  prompt_upsampling?: boolean
  safety_tolerance?: number
  output_format?: string
}

interface FluxResponse {
  id: string
  polling_url: string
}

interface FluxResult {
  status: string
  result?: {
    sample: string
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { conversationId, editPrompt } = await req.json()
    
    if (!conversationId || !editPrompt) {
      throw new Error('Missing conversationId or editPrompt')
    }

    console.log('Starting image edit for conversation:', conversationId)

    // Get conversation data
    const { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    if (fetchError || !conversation) {
      throw new Error('Conversation not found')
    }

    if (!conversation.image_url) {
      throw new Error('No image found for this conversation')
    }

    // Download the image and convert to base64
    const imageResponse = await fetch(conversation.image_url)
    if (!imageResponse.ok) {
      throw new Error('Failed to download image')
    }

    const imageBlob = await imageResponse.blob()
    
    // Check image size (limit to 10MB to prevent memory issues)
    if (imageBlob.size > 10 * 1024 * 1024) {
      throw new Error('Image too large - maximum 10MB allowed')
    }
    
    const arrayBuffer = await imageBlob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Convert to base64 in chunks to avoid stack overflow
    let base64Image = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize)
      base64Image += btoa(String.fromCharCode.apply(null, Array.from(chunk)))
    }

    console.log('Image downloaded and converted to base64')

    // Create FLUX.1 Kontext request
    const fluxRequest: FluxRequest = {
      prompt: editPrompt,
      input_image: base64Image,
      output_format: 'jpeg',
      safety_tolerance: 2
    }

    console.log('Making request to FLUX.1 Kontext API')

    // Call FLUX.1 Kontext API
    const bflApiKey = Deno.env.get('BFL_API_KEY')
    if (!bflApiKey) {
      throw new Error('BFL_API_KEY not found in environment')
    }

    const createResponse = await fetch('https://api.bfl.ai/v1/flux-kontext-pro', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'x-key': bflApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fluxRequest)
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      console.error('FLUX API error:', errorText)
      throw new Error(`FLUX API error: ${createResponse.status} - ${errorText}`)
    }

    const createResult: FluxResponse = await createResponse.json()
    console.log('FLUX request created:', createResult.id)
    console.log('Polling URL:', createResult.polling_url)

    // Poll for result using the polling_url from the response (required for global endpoint)
    let attempts = 0
    const maxAttempts = 60 // 3 minutes max with exponential backoff
    let result: FluxResult
    let delay = 2000 // Start with 2 seconds

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delay))
      
      try {
        // Use the polling_url returned by the API instead of constructing our own
        const pollResponse = await fetch(createResult.polling_url, {
          headers: {
            'accept': 'application/json',
            'x-key': bflApiKey,
          }
        })

        if (!pollResponse.ok) {
          console.error(`Polling error: ${pollResponse.status} - ${pollResponse.statusText}`)
          console.error(`Polling URL: ${createResult.polling_url}`)
          
          // Handle different error types
          if (pollResponse.status === 429) {
            // Rate limit - longer backoff
            delay = Math.min(delay * 2, 10000)
          } else if (pollResponse.status >= 500) {
            // Server error - moderate backoff
            delay = Math.min(delay * 1.5, 8000)
          } else if (pollResponse.status === 404) {
            // Not found - might be too early, shorter backoff
            delay = Math.min(delay * 1.2, 3000)
          } else {
            // Other client errors - standard backoff
            delay = Math.min(delay * 1.5, 5000)
          }
          
          attempts++
          continue
        }

        result = await pollResponse.json()
        console.log('Poll result status:', result.status, 'attempt:', attempts + 1)

        if (result.status === 'Ready') {
          console.log('Image edit completed successfully')
          break
        } else if (result.status === 'Error' || result.status === 'Failed') {
          throw new Error(`Image editing failed: ${JSON.stringify(result)}`)
        } else if (result.status === 'Content Moderated') {
          throw new Error('Content was moderated and cannot be processed')
        } else if (result.status === 'Request Moderated') {
          throw new Error('Request was moderated and cannot be processed')
        }

        attempts++
        // Reset delay on successful response
        delay = Math.max(2000, delay * 0.9) // Gradually reduce delay but keep minimum
      } catch (pollError) {
        console.error('Error during polling:', pollError)
        attempts++
        delay = Math.min(delay * 1.5, 8000)
        if (attempts >= maxAttempts) {
          throw pollError
        }
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error('Image editing timed out')
    }

    if (!result!.result?.sample) {
      throw new Error('No result image received')
    }

    // Download the edited image
    const editedImageResponse = await fetch(result!.result.sample)
    if (!editedImageResponse.ok) {
      throw new Error('Failed to download edited image')
    }

    const editedImageBlob = await editedImageResponse.blob()

    // Upload to Supabase storage
    const fileName = `${conversationId}-edited-${Date.now()}.jpg`
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('images')
      .upload(fileName, editedImageBlob, {
        contentType: 'image/jpeg'
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      throw new Error('Failed to upload edited image')
    }

    const { data: publicUrlData } = supabase.storage
      .from('images')
      .getPublicUrl(fileName)

    // Update conversation with edited image
    await supabase
      .from('conversations')
      .update({
        image_url: publicUrlData.publicUrl,
        state: 'waiting_for_video_decision'
      })
      .eq('id', conversationId)

    console.log('Conversation updated with edited image')

    // Send the edited image via Twilio
    await supabase.functions.invoke('send-edited-image', {
      body: { conversationId }
    })

    return new Response(
      JSON.stringify({ 
        success: true, 
        editedImageUrl: publicUrlData.publicUrl 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in flux-image-edit function:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})