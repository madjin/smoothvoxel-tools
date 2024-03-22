const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Function to find all .vox files recursively in a directory
function findVoxFiles(directory) {
  const voxFiles = [];
  const files = fs.readdirSync(directory);
  files.forEach((file) => {
    const filePath = path.join(directory, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      voxFiles.push(...findVoxFiles(filePath));
    } else if (file.endsWith('.vox')) {
      voxFiles.push(filePath);
    }
  });
  return voxFiles;
}

// Function to ensure a directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

(async () => {
  try {
    const browser = await puppeteer.launch({ 
      headless: true,
      defaultViewport: null,
      args: ['--start-maximized']
    });
    let page = await browser.newPage();

    // Go to the page
    await page.goto('http://0.0.0.0:8080/site/playground.html');

    // Define input and output directories
    const inputDirectory = process.argv[2];
    const outputDirectory = process.argv[3];

    // Get a list of .vox files recursively in the input directory
    const voxFiles = findVoxFiles(inputDirectory);

    // Process each .vox file
    for (const voxFile of voxFiles) {
      const inputFilename = voxFile;
      const relativePath = path.relative(inputDirectory, voxFile);
      const outputFilename = path.join(outputDirectory, relativePath.replace('.vox', '.svox'));

      // Ensure the output directory exists
      ensureDirectoryExists(path.dirname(outputFilename));

      // Read the .VOX file
      const data = fs.readFileSync(inputFilename);
      const base64 = Buffer.from(data).toString('base64');

      // Inject base64 into the page and call the function
      await page.evaluate((base64) => {
        window.loadMagicaVoxelFromBuffer(base64);
      }, base64);

      // Wait for the editor content to become non-empty with a timeout
      const waitForContentTimeout = 2000; // Timeout in milliseconds
      const contentWaitingPromise = page.waitForFunction(() => {
        const editorContent = editor.getValue();
        return editorContent.trim().length > 0;
      }, { timeout: waitForContentTimeout });

      try {
        await contentWaitingPromise;
      } catch (error) {
        console.error(`Timeout waiting for content in ${inputFilename}.`);
        await page.keyboard.press('Escape'); // Press Escape key to dismiss error
        continue; // Move to the next file if timeout occurs
      }

      // Get the editor content
      const editorContent = await page.evaluate(() => {
        return editor.getValue();
      });

      // Replace line breaks and write editor content to file
      const formattedContent = editorContent.replace(/(\r\n|\n)/gm, '\r\n');
      fs.writeFileSync(outputFilename, formattedContent);

      console.log(`Editor content written to ${outputFilename}`);
    }

    // Close the browser after processing all files
    await browser.close();
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();
