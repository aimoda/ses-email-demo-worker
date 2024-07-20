import { AwsClient } from 'aws4fetch';
import { createMimeMessage } from 'mimetext/browser';

export interface Env {
  CF_VERSION_METADATA: WorkerVersionMetadata;
  ENVIRONMENT: string;
  AWS_SES_ACCESS_KEY_ID: string
  AWS_SES_SECRET_ACCESS_KEY: string
  AWS_SES_REGION: string
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  return btoa(
    bytes.reduce((acc, current) => acc + String.fromCharCode(current), "")
  );
}

function utf8ToBase64(str: string): string {
  return encodeBase64Bytes(new TextEncoder().encode(str));
}

// Source: https://github.com/nodemailer/libqp/blob/5e1893035049cbe1b148b3a02b9d36feccbddf9f/lib/libqp.js#L9C1-L43C2
/**
 * Encodes an ArrayBuffer or string into a Quoted-Printable encoded string.
 *
 * @param input ArrayBuffer or string to convert
 * @returns Quoted-Printable encoded string
 */
function encodeToQuotedPrintable(input: ArrayBuffer | string): string {
  let buffer: Uint8Array;

  if (typeof input === 'string') {
    const encoder = new TextEncoder();
    buffer = encoder.encode(input);
  } else {
    buffer = new Uint8Array(input);
  }

  // Usable characters that do not need encoding
  const ranges: Array<[number, number?]> = [
    [0x09], // <TAB>
    [0x0a], // <LF>
    [0x0d], // <CR>
    [0x20, 0x3c], // <SP>!"#$%&'()*+,-./0123456789:;
    [0x3e, 0x7e], // >?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}
  ];
  let result = '';
  let ord: number;

  const checkRanges = (value: number, ranges: Array<[number, number?]>): boolean => {
    for (let range of ranges) {
      if ((range.length === 1 && value === range[0]) || 
        (range.length === 2 && value >= range[0] && (range[1] === undefined || value <= range[1]))) {
        return true;
      }
    }
    return false;
  };

  for (let i = 0, len = buffer.length; i < len; i++) {
    ord = buffer[i];
    // if the char is in allowed range, then keep as is, unless it is a ws at the end of a line
    if (checkRanges(ord, ranges) && !((ord === 0x20 || ord === 0x09) && 
      (i === len - 1 || buffer[i + 1] === 0x0a || buffer[i + 1] === 0x0d))) {
      result += String.fromCharCode(ord);
      continue;
    }
    result += '=' + (ord < 0x10 ? '0' : '') + ord.toString(16).toUpperCase();
  }

  return result;
}

function is7BitWithLineLengthLimit(text: string): boolean {
  const lines = text.split(/\r?\n/); // Split the text into lines using either \r\n or \n as the line separator
  const lineLengthLimit = 998; // Maximum line length limit excluding line separator

  for (const line of lines) {
    if (line.length > lineLengthLimit) {
      return false; // Line length exceeds the limit
    }
  }

  return /^[\x00-\x7F]*$/.test(text); // Check if the text contains only 7-bit ASCII characters
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const destination = "david@ses-email-demo-worker.testing.email.ai.moda";
    const subject = "Hello, world!";
    const plaintext = "Hello, world!";
    const html = "<p>Hello, world!</p>";

    const worker_user_agent = `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; modabot/${env.CF_VERSION_METADATA.id}; +https://www.ai.moda/en/contact)`;

    const new_email = createMimeMessage();

    new_email.setSender({
      name: "modabot",
      addr: "modabot@ai.moda"
    });

    new_email.setTo({
      name: "David Manouchehri",
      addr: destination
    });

    new_email.setSubject(subject);

    if(plaintext) {
      const canBe7bit = is7BitWithLineLengthLimit(plaintext);

      new_email.addMessage({
        data: canBe7bit ? plaintext : encodeToQuotedPrintable(plaintext),
        contentType: 'text/plain',
        encoding: canBe7bit ? '7bit' : 'quoted-printable',
        charset: '"utf-8"'
      });
    }
    
    if(html) {
      const canBe7bit = is7BitWithLineLengthLimit(html);

      new_email.addMessage({
        data: canBe7bit ? html : encodeToQuotedPrintable(html),
        contentType: 'text/html',
        encoding: canBe7bit ? '7bit' : 'quoted-printable',
        charset: '"utf-8"'
      });
    }

    const aws_client = new AwsClient({
      accessKeyId: env.AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY,
      service: 'ses',
      retries: 0,
    });

    const SES_API = `https://email.${env.AWS_SES_REGION}.amazonaws.com/v2/email/outbound-emails`;

    // https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
    const body = {
      Content: {
        Raw: {
          Data: utf8ToBase64(new_email.asRaw())
        }
      },
      Destination: {
        BccAddresses: [ destination ],
      },
      EmailTags: [
        {
          Name: "SERVER_TYPE",
          Value: "SES_EMAIL_DEMO_WORKER"
        }
      ],
    };

    const ses_prom = aws_client.fetch(SES_API,
      {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': worker_user_agent,
        },
      }).then(async (res) => {
        if(!res.ok) {
          console.error(`SES response not ok: ${res.status}`);
          if(res.body) {
            console.error(`SES response body: ${await res.text()}`);
          }
          throw new Error(`SES response not ok: ${res.status}`);
        }
        else {
          console.debug(`SES response ok: ${res.status}`);
          const res_json = await res.json();
          console.debug(`SES response body: ${JSON.stringify(res_json)}`);
        }
      });

    ctx.waitUntil(ses_prom);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response(null, { status: 404 });
  }
};
