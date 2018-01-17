# Production Environment Installation Document
For the production environment for this exam assignment I chose my good old Synology NAS/mini-server DS1812+. It runs a a special Linux distribution that is managed by Synology. In addition to being a network attached storage, it can act as a server for several services that Synology provides (in addition to being a file server).

The **working area** on the server (in this document I will refer to DS1812+ as server) is set to be in the directory `'/volume1/MINE'`.

For the exam assignment, we need the following requirements:
* SSH Server: The server has SSH service built in by default. We just have to activate it to run on port `'22522'`.
* NGINX Server: The server has NGINX v1.12.1 built-in to it to work as a reverse proxy for the installed/to-be-installed services that Synology provides. The configuration file for NGINX being located on `'/etc/nginx/nginx.conf'` made it very easy to chage those settings; and when done, we just run `'nginx -s reload'` and the settings are instantly applied.
* Git Server: Synology provides a Git Server v2.11.3 package to install through the web management GUI (only installation is available through web GUI; all other setting have to be done though SSH).
* Node.js: The node.js package provided by Synology is and old one for the exam assignment (v4). So, I downloaded a the newest version (then v9.3.0) form node.js site at `'https://nodejs.org/dist/v9.3.0/node-v9.3.0-linux-x64.tar.gz'`.

### Production Environment Preparation
Now that we had the requirements ready, we did the following:
* Installed the Git server and prepared it (using SSH) to our needs as follows:
	1. Created the production directory `'produc/assig3'`.
	2. Created a directory `'git_repos/assig3'` in the working area and cd to it. 
	3. Used `'git init --bare'` command to initialize an empty repository.
	4. cd into newly created `'hooks'` directory and create a shell-script file `'post-receive'` with content:
		> #!/bin/sh
		> 
		> git --work-tree /volume1/MINE/produc/assig3 --git-dir=/volume1/MINE/git_repos/assig3 checkout -f
	
    	Then we make it executable using the command `'chmod +x ./post-receive'`. We then created a git hook for this repository that deploys the code being pushed to this branch (we will set it as `'production'` branch) to the production directory. It runs after the entire push process is completed when we push to this repository.
	5. In our development environment, we add the production remote using the command:
		> git remote add production ssh://root@azmat.se:22522/volume1/MINE/git_repos/assig3

		Then we notice that all the needed files were deployed to `'produc/assig3'` directory after we run `'git push production'` in the developement environment.
* Installed Node.js by extracting its downloaded `'node-v9.3.0-linux-x64.tar.gz'` file to `'node'` directory in the working area, and add the `'bin'` directory inside it to the Linux PATH in the `'/etc/profile'` file to be able to run node.js anywhere. After that, we install PM2 globally (since it is a requirement for the exam assignment) using the command `'npm install -g pm2'`.
* Prepared the DNS server for our domain `'azmat.se'` to point to our/server's IP address (it is already don, but we check it again).
* For the HTTPS part of the exam assignment, and since a domain is available, we would use `'Let's Encrypt'` to create our SSL/TLS Certificates. Even though Synology provides an easy way to achieve that through its web management GUI, the `'zerossl.com'` site provides an excellent wizard that walks us through the process of creating the SSL/TLS Certificates and its keys. We then concatenated the content of the public key file and the CA chain cert file into one file `'fullchain.pem'`. We then had the `'fullchain.pem'` and `'privkey.pem'` ready.
* For the NGINX part, the NGINX configuration file already has some configurations that we need to keep while adding our own. The `'nginx.conf'` file already has this structure (without its many content), and we added our bocks like this:
~~~~
http {
  ...
  ssl_certificate       /path/to/fullchain.pem; # We add this line if not exists
  ssl_certificate_key   /path/to/privkey.pem; # We add this line if not exists
  ...
  server { # For none-secure management GUI
    listen 5500 default_server;
    listen [::]:5500 default_server;
    ...
  }
  server { # For secure management GUI
    listen 5501 default_server ssl http2;
    listen [::]:5501 default_server ssl http2;
    ...
  }
  server { # For port 80
    listen 80 default_server;
    listen [::]:80 default_server;
    ...
    location = / { # We add this block to redirect HTTP to HTTPS
      rewrite / https://$host/ redirect;
    }
  }
  server { # For port 443
    listen 443 default_server ssl;
    listen [::]:443 default_server ssl;
    ...
    location /websock { # We add this block to reverse proxy the websocket requests
      proxy_pass http://127.0.0.1:4000/websock;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
    }
    location ~ ^/(javascript/|stylesheets/|favicon.ico) { # We add this to handle static content
      root /volume1/MINE/produc/assig3/www;
      access_log off;
      expires max;
    }
    # the next two blocks reverse proxy the rest to our app
    # It was separated to two blocks due to other settings (was necessary this way)
    location / {
      proxy_pass http://127.0.0.1:4000/;
    }
    location = / {
      proxy_pass http://127.0.0.1:4000/;
    }
  }
}
~~~~
  We save those new settings an run `'nginx -s reload'` to apply them.
* Now that we pushed and deployed to `'production'`, we now run `'npm install --production'`, and then start the app in the production environment using the command `'NODE_ENV=production pm2 start server.js --name "repoServer"'` (for future simplicity, we put this command in a shell file). We then had our server running in production environment.
