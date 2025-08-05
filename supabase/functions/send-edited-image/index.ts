import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { conversationId } = await req.json()
    
    if (!conversationId) {
      throw new Error('Missing conversationId')
    }

    console.log('Sending edited image for conversation:', conversationId)

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
      throw new Error('No edited image found')
    }

    // Send the edited image via Twilio
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER')!

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`
    
    const params = new URLSearchParams()
    params.append('To', conversation.phone_number)
    params.append('From', twilioPhoneNumber)
    params.append('Body', 'Here\'s your edited image! Would you like to:\n• "Proceed to video" - to animate this edited image\n• "Make another edit" - to further modify the image')
    params.append('MediaUrl', conversation.image_url)

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    })

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text()
      console.error('Twilio error:', errorText)
      throw new Error(`Failed to send message via Twilio: ${twilioResponse.status}`)
    }

    const twilioResult = await twilioResponse.json()
    console.log('Message sent successfully:', twilioResult.sid)

    return new Response(
      JSON.stringify({ success: true, messageSid: twilioResult.sid }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in send-edited-image function:', error)
    
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