/*******************************************************************************
 * Copyright (c) 2020, 2020 IBM Corp. and others
 *
 * This program and the accompanying materials are made available under
 * the terms of the Eclipse Public License 2.0 which accompanies this
 * distribution and is available at https://www.eclipse.org/legal/epl-2.0/
 * or the Apache License, Version 2.0 which accompanies this distribution and
 * is available at https://www.apache.org/licenses/LICENSE-2.0.
 *
 * This Source Code may also be made available under the following
 * Secondary Licenses when the conditions for such availability set
 * forth in the Eclipse Public License, v. 2.0 are satisfied: GNU
 * General Public License, version 2 with the GNU Classpath
 * Exception [1] and GNU General Public License, version 2 with the
 * OpenJDK Assembly Exception [2].
 *
 * [1] https://www.gnu.org/software/classpath/license.html
 * [2] http://openjdk.java.net/legal/assembly-exception.html
 *
 * SPDX-License-Identifier: EPL-2.0 OR Apache-2.0 OR GPL-2.0 WITH Classpath-exception-2.0 OR LicenseRef-GPL-2.0 WITH Assembly-exception
 *******************************************************************************/
import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import * as io from '@actions/io'
import * as path from 'path'
import * as fs from 'fs'
import * as childProcess from 'child_process'
import {ExecOptions} from '@actions/exec/lib/interfaces'

const workDir = process.env['GITHUB_WORKSPACE']
const IS_WINDOWS = process.platform === "win32"
const targetOs = IS_WINDOWS ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
let tempDirectory = process.env['RUNNER_TEMP'] || ''
if (!tempDirectory) {
  let baseLocation;

  if (IS_WINDOWS) {
    // On windows use the USERPROFILE env variable
    baseLocation = process.env['USERPROFILE'] || 'C:\\';
  } else if (process.platform === 'darwin') {
    baseLocation = '/Users'
  } else {
    baseLocation = '/home'
  }
  tempDirectory = path.join(baseLocation, 'actions', 'temp')
}

export async function buildJDK(
  version: string,
  usePersonalRepo: boolean,
  specifiedReposMap: Map<string, string>
): Promise<void> {
  const openj9Version = `openj9-openjdk-jdk${version}`
  await installDependencies(version)
  process.chdir(`${workDir}`)
  await getBootJdk(version)
  process.chdir(`${workDir}`)
  await getSource(openj9Version, usePersonalRepo, specifiedReposMap)
  await setConfigure(version, openj9Version)
  await exec.exec(`make all`)
  await printJavaVersion(version, openj9Version)
}

async function installDependencies(version: string): Promise<void> {
  if (`${targetOs}` === 'mac') {
    await installMacDepends()
  } else if (`${targetOs}` === 'linux') {
    await installLinuxDepends(version)
  } else {
    await installWindowsDepends(version)
  }
  await installCommons()
}

async function installCommons(): Promise<void> {
  if (!IS_WINDOWS) {
    process.chdir(`${workDir}`)
    const freeMarker = await tc.downloadTool(`https://sourceforge.net/projects/freemarker/files/freemarker/2.3.8/freemarker-2.3.8.tar.gz/download`)
    await exec.exec(`sudo tar -xzf ${freeMarker} freemarker-2.3.8/lib/freemarker.jar --strip=2`)
    await io.rmRF(`${freeMarker}`)
  }
}

async function installMacDepends(): Promise<void> {
  await exec.exec('brew install autoconf ccache coreutils bash nasm gnu-tar')
  core.addPath('/usr/local/opt/gnu-tar/libexec/gnubin')
  core.info(`path is ${process.env['PATH']}`)
}

async function installLinuxDepends(version: string): Promise<void> {
  const ubuntuVersion = await getOsVersion()
  if (`${ubuntuVersion}` === '16.04') {
    await exec.exec('sudo apt-get update')
    await exec.exec(
      'sudo apt-get install -qq -y --no-install-recommends \
      python-software-properties \
      realpath'
    )
  }
  
  await exec.exec(`sudo apt-get update`)
  await exec.exec(
    'sudo apt-get install -qq -y --no-install-recommends \
    software-properties-common \
    autoconf \
    cpio \
    libasound2-dev \
    libcups2-dev \
    libdwarf-dev \
    libelf-dev \
    libfontconfig1-dev \
    libfreetype6-dev \
    libx11-dev \
    libxext-dev \
    libxrender-dev \
    libxt-dev \
    libxtst-dev \
    make \
    libnuma-dev \
    nasm \
    pkg-config \
    ssh \
    gcc-multilib'
  )

  if (version === '8') {
    await exec.exec('sudo add-apt-repository ppa:openjdk-r/ppa')
    await exec.exec(`sudo apt-get update`)
    await exec.exec(
      'sudo apt-get install -qq -y --no-install-recommends openjdk-8-jdk'
    )
  } else {
    await exec.exec(`sudo apt-get update`)
    await exec.exec(
      'sudo apt-get install -qq -y --no-install-recommends libxrandr-dev'
    )
  }
  await io.rmRF(`/var/lib/apt/lists/*`)
  
  //install cuda9
  const cuda9 = await tc.downloadTool('https://developer.nvidia.com/compute/cuda/9.0/Prod/local_installers/cuda_9.0.176_384.81_linux-run')
  await exec.exec(`sudo sh ${cuda9} --silent --toolkit --override`)
  await io.rmRF(`${cuda9}`)
  process.chdir('/usr/local')

  //install gcc binary
  const gccBinary = await tc.downloadTool(`https://ci.adoptopenjdk.net/userContent/gcc/gcc730+ccache.x86_64.tar.xz`)
  await exec.exec(`ls -l ${gccBinary}`)
  await exec.exec(`sudo tar -xJ --strip-components=1 -C /usr/local -f ${gccBinary}`)
  await io.rmRF(`${gccBinary}`)

  await exec.exec(`sudo ln -s /usr/lib/x86_64-linux-gnu /usr/lib64`)
  await exec.exec(`sudo ln -s /usr/include/x86_64-linux-gnu/* /usr/local/include`)
  await exec.exec(`sudo ln -sf /usr/local/bin/g++-7.3 /usr/bin/g++`)
  await exec.exec(`sudo ln -sf /usr/local/bin/gcc-7.3 /usr/bin/gcc`)
  process.env.LIBRARY_PATH=`/usr/lib/x86_64-linux-gnu:${process.env.LIBRARY_PATH}`

}

async function installWindowsDepends(version: string): Promise<void> {
 
  //install cgywin
  await io.mkdirP('C:\\cygwin64')
  await io.mkdirP('C:\\cygwin_packages')
  await tc.downloadTool('https://cygwin.com/setup-x86_64.exe', 'C:\\temp\\cygwin.exe')
  await exec.exec(`C:\\temp\\cygwin.exe  --packages wget,bsdtar,rsync,gnupg,git,autoconf,make,gcc-core,mingw64-x86_64-gcc-core,unzip,zip,cpio,curl,grep,perl --quiet-mode --download --local-install
  --delete-orphans --site  https://mirrors.kernel.org/sourceware/cygwin/
  --local-package-dir "C:\\cygwin_packages"
  --root "C:\\cygwin64"`)
  await exec.exec(`C:/cygwin64/bin/git config --system core.autocrlf false`)
  core.addPath(`C:\\cygwin64\\bin`)

  //freeMarker
  await tc.downloadTool(`https://repo.maven.apache.org/maven2/freemarker/freemarker/2.3.8/freemarker-2.3.8.jar`, `${workDir}\\freemarker.jar`)

  //nasm
  await io.mkdirP('C:\\nasm')
  await tc.downloadTool(`https://www.nasm.us/pub/nasm/releasebuilds/2.13.03/win64/nasm-2.13.03-win64.zip`, 'C:\\temp\\nasm.zip')
  await tc.extractZip('C:\\temp\\nasm.zip', 'C:\\nasm')
  const nasmdir = path.join('C:\\nasm', fs.readdirSync('C:\\nasm')[0])
  core.addPath(nasmdir)
  await io.rmRF('C:\\temp\\nasm.zip')
  
  //llvm
  await tc.downloadTool('https://ci.adoptopenjdk.net/userContent/winansible/llvm-7.0.0-win64.zip', 'C:\\temp\\llvm.zip')
  await tc.extractZip('C:\\temp\\llvm.zip', 'C:\\')
  await io.rmRF('C:\\temp\\llvm.zip')
  core.addPath('C:\\Program Files\\LLVM\\bin')
  //cuda
  await tc.downloadTool('https://developer.nvidia.com/compute/cuda/9.0/Prod/network_installers/cuda_9.0.176_win10_network-exe', 'C:\\temp\\cuda_9.0.176_win10_network-exe.exe')
  await exec.exec(`C:\\temp\\cuda_9.0.176_win10_network-exe.exe -s compiler_9.0 nvml_dev_9.0`)
  await io.rmRF(`C:\\temp\\cuda_9.0.176_win10_network-exe.exe`)
  
  //register necessary libraries, looks like those are registered by default in newly 2017 installation
  //await exec.exec(`regsvr32 "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Enterprise\\DIA SDK\\bin\\msdia140.dll"`)
  //await exec.exec(`regsvr32 "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Enterprise\\DIA SDK\\bin\\amd64\\msdia140.dl"`)

  //openssl
  await tc.downloadTool('https://www.openssl.org/source/openssl-1.1.1g.tar.gz', 'C:\\temp\\OpenSSL-1.1.1g.tar.gz')
  await tc.extractTar('C:\\temp\\OpenSSL-1.1.1g.tar.gz', 'C:\\temp')

  process.chdir('C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Enterprise\\VC\\Auxiliary\\Build')
  core.addPath('C:\\Strawberry\\perl\\bin')
  childProcess.execSync(`.\\vcvarsall.bat AMD64 && cd C:\\temp\\OpenSSL-1.1.1g && perl C:\\temp\\OpenSSL-1.1.1g\\Configure VC-WIN64A --prefix=C:\\OpenSSL-1.1.1g-x86_64-VS2017 && nmake.exe install > C:\\temp\\openssl64-VS2017.log && nmake.exe -f makefile clean`)
  await io.rmRF('C:\\temp\\OpenSSL-1.1.1g.tar.gz')
  await io.rmRF(`C:\\temp\\OpenSSL-1.1.1g`)

  if (version === '8') {
    core.setFailed('JDK8 for Windows is not available for now!')
    // TODO: install version 8 specific dependencies
    // https://github.com/eclipse/openj9/blob/master/doc/build-instructions/Build_Instructions_V8.md#windows
  }

}
//TODO: could be only call when default environment javahome doesn't work.
async function getBootJdk(version: string): Promise<void> {
  const bootJDKVersion = (parseInt(version) - 1).toString()
  if (parseInt(bootJDKVersion) > 8) {
    let bootjdkJar
    // TODO: issue open openj9,mac, 10 ga : https://api.adoptopenjdk.net/v3/binary/latest/10/ga/mac/x64/jdk/openj9/normal/adoptopenjdk doesn't work
    if (`${bootJDKVersion}` === '10') {
      //JDK 11 require a latest jdk11 as boot JVMhttps://github.com/eclipse-openj9/build-openj9/issues/25#issuecomment-848354452
      bootjdkJar = await tc.downloadTool(`https://github.com/AdoptOpenJDK/openjdk11-binaries/releases/download/jdk11u-2021-05-07-07-34/OpenJDK11U-jdk_x64_linux_openj9_2021-05-07-07-34.tar.gz`)
      if (`${targetOs}` === 'mac') {
        bootjdkJar = await tc.downloadTool(`https://github.com/AdoptOpenJDK/openjdk10-binaries/releases/download/jdk-10.0.2%2B13.1/OpenJDK10U-jdk_x64_mac_hotspot_10.0.2_13.tar.gz`)
      }
    } else {
      bootjdkJar = await tc.downloadTool(`https://api.adoptopenjdk.net/v3/binary/latest/${bootJDKVersion}/ga/${targetOs}/x64/jdk/openj9/normal/adoptopenjdk`)
    }
    await io.mkdirP('bootjdk')
    if (`${targetOs}` === 'mac') {
      await exec.exec(`sudo tar -xzf ${bootjdkJar} -C ./bootjdk --strip=3`)
    } else if (`${targetOs}` === 'linux') {
      if (`${bootJDKVersion}` === '10' && `${targetOs}` === 'mac' ) {
        await exec.exec(`sudo tar -xzf ${bootjdkJar} -C ./bootjdk --strip=2`) // TODO : issue open as this is packaged differently
      } else {
        await exec.exec(`sudo tar -xzf ${bootjdkJar} -C ./bootjdk --strip=1`)
      }
    } else {
      // windows jdk is zip file
      const tempDir = path.join(tempDirectory, 'temp_' + Math.floor(Math.random() * 2000000000))
      await tc.extractZip(bootjdkJar, `${tempDir}`)
      const tempJDKDir = path.join(tempDir, fs.readdirSync(tempDir)[0])
      await exec.exec(`mv ${tempJDKDir}/* ${workDir}/bootjdk`)
    }
    await io.rmRF(`${bootjdkJar}`)
  }
}

async function getSource(
  openj9Version: string,
  usePersonalRepo: boolean,
  specifiedReposMap: Map<string, string>
): Promise<void> {
  let openjdkOpenj9Repo = `ibmruntimes/${openj9Version}`
  let openjdkOpenj9Branch = 'openj9'
  let omrRepo = ''
  let omrBranch = ''
  let openj9Repo = ''
  let openj9Branch = ''
  if (usePersonalRepo) {
    const repo = process.env.GITHUB_REPOSITORY as string
    let branch = ''
    if (process.env.GITHUB_HEAD_REF === '') {
      const ref = process.env.GITHUB_REF as string
      branch = ref.substr(ref.lastIndexOf('/') + 1)
    } else {
      branch = process.env.GITHUB_HEAD_REF as string
    }

    if (repo.includes(`/${openj9Version}`)) {
      openjdkOpenj9Repo = repo
      openjdkOpenj9Branch = branch
    } else if (repo.includes('/openj9-omr')) {
      omrRepo = repo
      omrBranch = branch
    } else if (repo.includes('/openj9')) {
      openj9Repo = repo
      openj9Branch = branch
    } else {
      //parsing personal openj9Repo, openj9 Repo, openj9-omrRepo openj9-openjdkRepo'
      for (let [key, value] of specifiedReposMap) {
        const personalRepo = parseRepoBranch(value)[0]
        const personalBranch = parseRepoBranch(value)[1]
        switch(key) { 
          case "openj9Repo": { 
            openj9Repo = personalRepo
            openj9Branch = personalBranch
            break; 
          } 
          case "openj9-omrRepo": { 
            omrRepo = personalRepo
            omrBranch = personalBranch
            break; 
          }
          case "openj9-openjdkRepo": {
            openjdkOpenj9Repo = personalRepo
            openjdkOpenj9Branch = personalBranch
          }
          default: { 
             //statements; 
             break; 
          }
        } 
      }
    }
  }

  await exec.exec(`git clone -b ${openjdkOpenj9Branch} https://github.com/${openjdkOpenj9Repo}.git`)
  process.chdir(`${openj9Version}`)
  let omrParameters = ''
  let openj9Parameters = ''
  if (omrRepo.length !== 0) {
    omrParameters = `-omr-repo=https://github.com/${omrRepo}.git -omr-branch=${omrBranch}`
  }
  if (openj9Repo.length !== 0) {
    openj9Parameters = `-openj9-repo=https://github.com/${openj9Repo}.git -openj9-branch=${openj9Branch}`
  }

  let opensslversion = ''
  if (!IS_WINDOWS) {
    opensslversion = '--openssl-version=1.1.1g'
  }
  await exec.exec(`bash ./get_source.sh ${omrParameters} ${openj9Parameters} ${opensslversion}`)

  //Using default javahome for jdk8. TODO: only use specified bootjdk when necessary
/*   let bootjdkConfigure = ''
  if (parseInt(version) > 8)  bootjdkConfigure = `--with-boot-jdk=${workDir}/bootjdk`
  await exec.exec(`bash configure --with-freemarker-jar=${workDir}/freemarker.jar ${bootjdkConfigure}`) */
}

async function setConfigure(version: string, openj9Version: string): Promise<void> {
  let bootjdkConfigure = ''
  if (parseInt(version) > 8)  bootjdkConfigure = `--with-boot-jdk=${workDir}/bootjdk`
  let configureArgs
  if (`${targetOs}` === 'linux') {
    configureArgs = '--enable-jitserver  --with-openssl=fetched --enable-cuda --with-cuda=/usr/local/cuda-9.0'
    if (`${version}` === '8') {
      configureArgs += ' --disable-zip-debug-info'
    }
  }

  if (`${targetOs}` === 'mac') {
    configureArgs = '--with-openssl=fetched --enable-openssl-bundling'
    if (`${version}` === '8') {
      core.setFailed('JDK8 for Mac needs to build on a older OS version 10.11, macos-10.15 can not work for jdk8. please double check the jdkversion and os!')
      // TODO: JDK8 for Mac needs to build on a older OS version 10.11, if older version is available the following ... should be replaced with a full path.
      // Also note MACOSX_DEPLOYMENT_TARGET and SDKPATH are environment variables, not configure options.
      // configureArgs += ' --with-xcode-path=.../Xcode4/Xcode.app --with-openj9-cc=.../clang --with-openj9-cxx=.../clang++ --with-openj9-developer-dir=.../Developer MACOSX_DEPLOYMENT_TARGET=10.9.0 SDKPATH=.../MacOSX10.8.sdk'
    }
  }

  if (IS_WINDOWS) {
    configureArgs = '--with-openssl="c:/OpenSSL-1.1.1g-x86_64-VS2017" --enable-openssl-bundling --enable-cuda -with-cuda="C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v9.0"'
    if (`${version}` === '8') {
      //TODO 
      configureArgs += '--disable-zip-debug-info --with-freetype-include=.../freetype-2.5.3/include --with-freetype-lib=.../freetype-2.5.3/lib64'
    }
  }

  await exec.exec(`bash configure --with-freemarker-jar=${workDir}/freemarker.jar ${bootjdkConfigure} ${configureArgs}`)
}

async function printJavaVersion(version: string, openj9Version: string): Promise<void> {
  let platform
  if (`${targetOs}` === 'linux') {
    platform = 'linux'
  } else if (`${targetOs}` === 'mac') {
    platform = 'macosx'
  } else {
    platform = 'windows'
  }
  let platformRelease = `${platform}-x86_64-normal-server-release`
  if (parseInt(version) >= 13) platformRelease = `${platform}-x86_64-server-release`
  let jdkImages
  if (version === '8') {
    jdkImages = `build/${platformRelease}/images/j2sdk-image`
    process.chdir(`${jdkImages}/jre/bin`)
  } else {
    jdkImages = `build/${platformRelease}/images/jdk`
    process.chdir(`${jdkImages}/bin`)
  }
  await exec.exec(`./java -version`)
  //set outputs
  core.setOutput('BuildJDKDir', `${workDir}/${openj9Version}/${jdkImages}`)
}

async function getOsVersion(): Promise<string> {
  let osVersion = ''
  const options: ExecOptions = {}
  let myOutput = ''
  options.listeners = {
    stdout: (data: Buffer) => {
      myOutput += data.toString()
    }
  }

  if (IS_WINDOWS) {
    //TODO
  } else if (`${targetOs}` === 'mac') {
    //TODO
  } else {
    exec.exec(`lsb_release`, ['-r', '-s'], options)
    if (myOutput.includes('16.04')) {
      osVersion = '16.04'
    } else {
      osVersion = '18.04'
    }
  }
  return osVersion
}

function parseRepoBranch(repoBranch: string): string[] {
  const tempRepo = repoBranch.replace(/\s/g, '')
  return tempRepo.split(':')
}