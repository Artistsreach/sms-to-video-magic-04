import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TwilioMessage {
  MessageSid: string
  From: string
  To: string
  Body?: string
  NumMedia: string
  MediaUrl0?: string
  MediaContentType0?: string
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

    const formData = await req.formData()
    const twilioData: TwilioMessage = {
      MessageSid: formData.get('MessageSid') as string,
      From: formData.get('From') as string,
      To: formData.get('To') as string,
      Body: formData.get('Body') as string || '',
      NumMedia: formData.get('NumMedia') as string,
      MediaUrl0: formData.get('MediaUrl0') as string,
      MediaContentType0: formData.get('MediaContentType0') as string,
    }

    console.log('Received Twilio message:', twilioData)

    const phoneNumber = twilioData.From
    const hasMedia = parseInt(twilioData.NumMedia) > 0
    const messageBody = twilioData.Body?.trim().toLowerCase() || ''

    // Get or create conversation
    let { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!conversation) {
      const { data: newConversation } = await supabase
        .from('conversations')
        .insert({
          phone_number: phoneNumber,
          state: 'waiting_for_image'
        })
        .select()
        .single()
      
      conversation = newConversation
    }

    let responseMessage = ''

    // If new image is uploaded, always reset and start fresh
    if (hasMedia && twilioData.MediaUrl0) {
      // Download and store the image with proper Twilio authentication
      const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
      const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
      const auth = btoa(`${twilioAccountSid}:${twilioAuthToken}`)
      
      const imageResponse = await fetch(twilioData.MediaUrl0, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      })
      
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image from Twilio: ${imageResponse.status} ${imageResponse.statusText}`)
      }
      
      const imageBlob = await imageResponse.blob()
      
      // Validate the downloaded content
      if (imageBlob.size === 0) {
        throw new Error('Downloaded image is empty')
      }
      
      console.log('Downloaded image - Size:', imageBlob.size, 'Type:', imageBlob.type)
      
      // Validate content type for Veo 3 compatibility (only JPEG and PNG)
      const contentType = twilioData.MediaContentType0 || 'image/jpeg'
      if (!contentType.includes('jpeg') && !contentType.includes('jpg') && !contentType.includes('png')) {
        responseMessage = 'Please send a JPEG or PNG image file for video generation.'
      } else {
        // Determine file extension based on content type
        let fileExtension = '.jpg'
        if (contentType.includes('png')) {
          fileExtension = '.png'
        } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          fileExtension = '.jpg'
        }
        
        const fileName = `${conversation.id}-${Date.now()}${fileExtension}`
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('images')
          .upload(fileName, imageBlob, {
            contentType: contentType
          })

        if (uploadError) {
          console.error('Upload error:', uploadError)
          responseMessage = 'Sorry, there was an error processing your image. Please try again.'
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('images')
            .getPublicUrl(fileName)

          // Reset conversation and update with new image
          await supabase
            .from('conversations')
            .update({
              image_url: publicUrlData.publicUrl,
              state: 'waiting_for_edit_prompt',
              video_prompt: null,
              video_url: null,
              operation_id: null
            })
            .eq('id', conversation.id)

          responseMessage = 'Great! I received your image. What do you want to do with this image? Please describe how you\'d like to edit it (e.g., "add a sunset background", "make it look like a painting", "change the lighting").'
        }
      }
    } else if (conversation.state === 'waiting_for_edit_prompt') {
      if (messageBody && messageBody.length > 0) {
        // Update conversation state to processing edit
        await supabase
          .from('conversations')
          .update({
            state: 'processing_edit'
          })
          .eq('id', conversation.id)

        // Trigger image editing
        await supabase.functions.invoke('flux-image-edit', {
          body: { 
            conversationId: conversation.id,
            editPrompt: twilioData.Body
          }
        })

        responseMessage = 'Perfect! I\'m editing your image now. This may take a moment...'
      } else {
        responseMessage = 'Please describe how you\'d like to edit your image (e.g., "add a sunset background", "make it look like a painting").'
      }
    } else if (conversation.state === 'waiting_for_video_decision') {
      const lowerMessage = messageBody.toLowerCase()
      
      if (lowerMessage.includes('video') || lowerMessage.includes('animate') || lowerMessage.includes('yes') || lowerMessage.includes('proceed')) {
        responseMessage = 'Great! Now, how would you like to animate this edited image? Please describe the animation you want (e.g., "zebra galloping at high speeds").'
        
        // Update state to waiting for video prompt
        await supabase
          .from('conversations')
          .update({
            state: 'waiting_for_video_prompt'
          })
          .eq('id', conversation.id)
      } else if (lowerMessage.includes('edit') || lowerMessage.includes('change') || lowerMessage.includes('modify')) {
        responseMessage = 'What would you like to change about the image? Please describe the edit you want to make.'
        
        // Update state back to waiting for edit prompt
        await supabase
          .from('conversations')
          .update({
            state: 'waiting_for_edit_prompt'
          })
          .eq('id', conversation.id)
      } else {
        responseMessage = 'Would you like to:\n• "Proceed to video" - to animate this edited image\n• "Make another edit" - to further modify the image'
      }
    } else if (conversation.state === 'waiting_for_video_prompt') {
      if (messageBody && messageBody.length > 0) {
        // Update conversation with prompt and trigger video generation
        await supabase
          .from('conversations')
          .update({
            video_prompt: twilioData.Body,
            state: 'generating_video'
          })
          .eq('id', conversation.id)

        // Trigger video generation
        await supabase.functions.invoke('generate-video', {
          body: { conversationId: conversation.id }
        })

        responseMessage = 'Perfect! I\'m now generating your video. This may take a few minutes. I\'ll send you the result once it\'s ready.'
      } else {
        responseMessage = 'Please describe how you\'d like to animate your image (e.g., "zebra galloping at high speeds").'
      }
    } else if (conversation.state === 'processing_edit') {
      responseMessage = 'I\'m still working on editing your image. Please wait a moment...'
    } else if (conversation.state === 'generating_video') {
      responseMessage = 'I\'m still working on your video. Please wait a moment...'
    } else {
      // Reset conversation
      await supabase
        .from('conversations')
        .update({
          state: 'waiting_for_image',
          image_url: null,
          video_prompt: null,
          video_url: null,
          operation_id: null
        })
        .eq('id', conversation.id)

      responseMessage = 'Let\'s start fresh! Please send me an image that you\'d like to edit and animate into a video.'
    }

    // Send response via Twilio
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`

    return new Response(twiml, {
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    })

  } catch (error) {
    console.error('Error processing webhook:', error)
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, there was an error processing your request. Please try again.</Message>
</Response>`

    return new Response(errorTwiml, {
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    })
  }
})